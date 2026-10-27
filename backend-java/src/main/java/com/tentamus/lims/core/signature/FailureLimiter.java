package com.tentamus.lims.core.signature;

import com.tentamus.lims.core.web.RuleException;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Component;

/**
 * Wrong passwords per computer: 20 in 15 minutes (LIMS_FAIL_LIMIT), then that computer waits. The 5-try account lock
 * applies on top. shortcut: counted in this process only, apart from the Node backend's count, so a computer can make up to
 * twice the limit while both backends sign; move to a shared store when sign-in moves to Java.
 */
@Component
public class FailureLimiter {
    private static final long WINDOW_MS = 15 * 60 * 1000;
    private final int limit = Integer.parseInt(System.getenv().getOrDefault("LIMS_FAIL_LIMIT", "20"));
    private final Map<String, Deque<Long>> fails = new ConcurrentHashMap<>();

    public void check(String ip) {
        Deque<Long> list = recent(ip);
        synchronized (list) {
            if (list.size() >= limit) {
                long wait = (long) Math.ceil((WINDOW_MS - (System.currentTimeMillis() - list.peekFirst())) / 60000.0);
                throw RuleException.tooMany("Too many wrong passwords from this computer. Wait " + wait + " minute" + (wait == 1 ? "" : "s") + " and try again.");
            }
        }
    }

    public void note(String ip) {
        Deque<Long> list = recent(ip);
        synchronized (list) { list.addLast(System.currentTimeMillis()); }
    }

    private Deque<Long> recent(String ip) {
        Deque<Long> list = fails.computeIfAbsent(ip == null ? "unknown" : ip, k -> new ArrayDeque<>());
        long now = System.currentTimeMillis();
        synchronized (list) { while (!list.isEmpty() && now - list.peekFirst() >= WINDOW_MS) list.pollFirst(); }
        return list;
    }
}
