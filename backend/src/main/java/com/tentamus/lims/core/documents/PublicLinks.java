package com.tentamus.lims.core.documents;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * The address people open (links printed in PDFs and emails): LIMS_PUBLIC_URL, else http://localhost:PORT, without a
 * trailing slash, as the Node backend's verifyBase()/base() wrote it.
 */
@Component
public class PublicLinks {
    private final String base;

    public PublicLinks(@Value("${lims.public-url:}") String publicUrl, @Value("${lims.public-port:3000}") String port) {
        String b = publicUrl == null || publicUrl.isEmpty() ? "http://localhost:" + (port == null || port.isEmpty() ? "3000" : port) : publicUrl;
        this.base = b.endsWith("/") ? b.substring(0, b.length() - 1) : b;
    }

    public String base() { return base; }
}
