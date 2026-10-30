package com.tentamus.lims.core.browser;

import com.microsoft.playwright.Browser;
import com.microsoft.playwright.BrowserContext;
import com.microsoft.playwright.BrowserType;
import com.microsoft.playwright.ElementHandle;
import com.microsoft.playwright.Page;
import com.microsoft.playwright.Playwright;
import com.microsoft.playwright.options.Cookie;
import com.microsoft.playwright.options.LoadState;
import com.microsoft.playwright.options.Margin;
import com.microsoft.playwright.options.WaitUntilState;
import com.tentamus.lims.core.web.RuleException;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.function.Function;
import org.springframework.beans.factory.DisposableBean;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Headless Chromium for the documents and evidence the server makes (the Node backend's coa.js browser() and evidence.js):
 * one browser, kept open a minute after its last use, then closed. PDFs are US Letter with the LIMS footer (a line of text
 * on the left, "Page X of Y" on the right). Playwright objects may be used by one thread at a time, so every use holds
 * this object's lock: documents are made one after another. PLAYWRIGHT_PATH names a Chromium to use instead of the one
 * Playwright downloads on first use.
 */
@Component
public class HeadlessBrowser implements DisposableBean {
    private static final long KEEP_MS = 60_000;
    private final String executable;
    private final ScheduledExecutorService timer = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread t = new Thread(r, "headless-browser-idle");
        t.setDaemon(true);
        return t;
    });
    private Playwright playwright;
    private Browser browser;
    private ScheduledFuture<?> idle;

    public HeadlessBrowser(@Value("${lims.playwright-path:}") String executable) { this.executable = executable == null ? "" : executable.trim(); }

    /** A page already rendered from HTML: read its cells back, then print it. */
    public interface Rendered {
        /** For every element matching the selector: the attribute's value and the element's trimmed text, in page order. */
        List<String[]> readBack(String selector, String attribute);

        /** The page as a PDF, with the footer (its left part as HTML, already escaped). */
        byte[] pdf(String footerHtml, boolean landscape);
    }

    /** HTML to a PDF (coa.js htmlToPdf): Letter, 0.6 in margins (0.75 in at the bottom), backgrounds printed. */
    public byte[] htmlToPdf(String html, String footerHtml, boolean landscape) {
        return render(html, r -> r.pdf(footerHtml, landscape));
    }

    /** Renders the HTML (waiting for its images to load) and gives the page to the work; the page is closed after. */
    public synchronized <T> T render(String html, Function<Rendered, T> work) {
        Page page = browser().newPage();
        try {
            page.setContent(html, new Page.SetContentOptions().setWaitUntil(WaitUntilState.LOAD));
            return work.apply(new Rendered() {
                public List<String[]> readBack(String selector, String attribute) {
                    List<String[]> out = new ArrayList<>();
                    for (ElementHandle e : page.querySelectorAll(selector)) out.add(new String[] {e.getAttribute(attribute), e.textContent().trim()});
                    return out;
                }

                public byte[] pdf(String footerHtml, boolean landscape) { return page.pdf(pdfOptions(footerHtml, landscape)); }
            });
        } finally {
            page.close();
        }
    }

    /**
     * A browser window of the given size carrying the cookies (each {name, value, url}) and a script run before every page
     * (may be null), for the work to drive (the verification evidence capture). The window is closed after.
     */
    public synchronized <T> T withPage(int width, int height, List<Cookie> cookies, String initScript, Function<Page, T> work) {
        BrowserContext ctx = browser().newContext(new Browser.NewContextOptions().setViewportSize(width, height));
        try {
            if (cookies != null && !cookies.isEmpty()) ctx.addCookies(cookies);
            if (initScript != null) ctx.addInitScript(initScript);
            return work.apply(ctx.newPage());
        } finally {
            ctx.close();
        }
    }

    /** One page of the app as a full-page PNG, seen with the session cookie (name and value) at the given window size. */
    public byte[] screenshot(String url, String cookieName, String cookieValue, int width, int height) {
        List<Cookie> cookies = cookieName == null ? List.of() : List.of(new Cookie(cookieName, cookieValue).setUrl(url));
        return withPage(width, height, cookies, null, page -> {
            page.navigate(url);
            page.waitForLoadState(LoadState.LOAD);
            return page.screenshot(new Page.ScreenshotOptions().setFullPage(true));
        });
    }

    static String footer(String leftHtml) {
        return "<div style=\"font:7.5pt Helvetica,Arial,sans-serif;color:#5c6773;width:100%;padding:0 0.6in;display:flex;justify-content:space-between\"><span>"
            + (leftHtml == null ? "" : leftHtml) + "</span><span>Page <span class=\"pageNumber\"></span> of <span class=\"totalPages\"></span></span></div>";
    }

    static Page.PdfOptions pdfOptions(String footerHtml, boolean landscape) {
        return new Page.PdfOptions().setFormat("Letter").setLandscape(landscape).setPrintBackground(true).setDisplayHeaderFooter(true)
            .setHeaderTemplate("<span></span>").setFooterTemplate(footer(footerHtml))
            .setMargin(new Margin().setTop("0.6in").setBottom("0.75in").setLeft("0.6in").setRight("0.6in"));
    }

    /** The open browser, started when needed; its idle timer starts again. Called with the lock held. */
    private Browser browser() {
        if (idle != null) idle.cancel(false);
        idle = timer.schedule(this::closeIfIdle, KEEP_MS, TimeUnit.MILLISECONDS);
        if (browser != null && browser.isConnected()) return browser;
        close();
        try {
            boolean own = !executable.isEmpty();
            playwright = Playwright.create(new Playwright.CreateOptions().setEnv(own ? Map.of("PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD", "1") : Map.of()));
            BrowserType.LaunchOptions o = new BrowserType.LaunchOptions().setHeadless(true);
            if (own) o.setExecutablePath(Path.of(executable));
            browser = playwright.chromium().launch(o);
            return browser;
        } catch (RuntimeException e) {
            close();
            throw new RuleException("PDFs and screenshots need headless Chromium on the computer running LIMS3. Playwright downloads it the first time"
                + " (this needs internet access), or set PLAYWRIGHT_PATH to a Chromium. " + String.valueOf(e.getMessage()).split("\n")[0]);
        }
    }

    private synchronized void closeIfIdle() { close(); }

    private void close() {
        try { if (browser != null) browser.close(); } catch (RuntimeException ignored) { /* already gone */ }
        try { if (playwright != null) playwright.close(); } catch (RuntimeException ignored) { /* already gone */ }
        browser = null;
        playwright = null;
    }

    @Override
    public synchronized void destroy() {
        timer.shutdownNow();
        close();
    }
}
