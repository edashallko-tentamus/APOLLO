package com.tentamus.lims;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

/** The LIMS3 API in Java. It migrates the database at start, then serves the API (the front end forwards /api here) and runs the background jobs. */
@SpringBootApplication
@EnableScheduling
public class LimsApplication {
    public static void main(String[] args) {
        SpringApplication.run(LimsApplication.class, args);
    }
}
