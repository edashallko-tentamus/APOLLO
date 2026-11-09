package com.tentamus.lims.core.signature;

import com.tentamus.lims.core.web.RuleException;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Per-computer limits, kept in memory (the Node backend's ratelimit.js): wrong passwords (sign in, change password,
 * signatures, witnesses) 20 in 15 minutes (LIMS_FAIL_LIMIT), then that computer waits; pages that need no sign-in
 * (/api/public/...) 120 requests a minute (LIMS_PUBLIC_LIMIT). The 5-try account lock applies on top.
 */
@Component
public class FailureLimiter {
    private static final long FAIL_WINDOW_MS = 15 * 60 * 1000;
    private static final long PUBLIC_WINDOW_MS = 60 * 1000;
    private final int failLimit;
    private final int publicLimit;
    private final Map<String, Deque<Long>> fails = new ConcurrentHashMap<>();
    private final Map<String, Deque<Long>> hits = new ConcurrentHashMap<>();

    public FailureLimiter(@Value("${lims.fail-limit:20}") int failLimit, @Value("${lims.public-limit:120}") int publicLimit) {
        this.failLimit = failLimit;
        this.publicLimit = publicLimit;
    }

    public void check(String ip) {
        Deque<Long> list = recent(fails, ip, FAIL_WINDOW_MS);
        synchronized (list) {
            if (list.size() >= failLimit) {
                long wait = (long) Math.ceil((FAIL_WINDOW_MS - (System.currentTimeMillis() - list.peekFirst())) / 60000.0);
                throw RuleException.tooMany("Too many wrong passwords from this computer. Wait " + wait + " minute" + (wait == 1 ? "" : "s") + " and try again.");
            }
        }
    }

    public void note(String ip) {
        Deque<Long> list = recent(fails, ip, FAIL_WINDOW_MS);
        synchronized (list) { list.addLast(System.currentTimeMillis()); }
    }

    /** A request to a public page: refused when the computer made too many this minute, else counted. */
    public void checkPublic(String ip) {
        Deque<Long> list = recent(hits, ip, PUBLIC_WINDOW_MS);
        synchronized (list) {
            if (list.size() >= publicLimit) throw RuleException.tooMany("Too many requests from this computer. Wait a minute and try again.");
            list.addLast(System.currentTimeMillis());
        }
    }

    /** Forgets computers with nothing recent, so the maps do not grow. */
    @Scheduled(fixedRate = 5 * 60 * 1000)
    public void prune() {
        prune(fails, FAIL_WINDOW_MS);
        prune(hits, PUBLIC_WINDOW_MS);
    }

    private static void prune(Map<String, Deque<Long>> map, long window) {
        for (String ip : map.keySet()) {
            Deque<Long> list = recent(map, ip, window);
            synchronized (list) { if (list.isEmpty()) map.remove(ip, list); }
        }
    }

    private static Deque<Long> recent(Map<String, Deque<Long>> map, String ip, long window) {
        Deque<Long> list = map.computeIfAbsent(ip == null ? "unknown" : ip, k -> new ArrayDeque<>());
        long now = System.currentTimeMillis();
        synchronized (list) { while (!list.isEmpty() && now - list.peekFirst() >= window) list.pollFirst(); }
        return list;
    }
}
