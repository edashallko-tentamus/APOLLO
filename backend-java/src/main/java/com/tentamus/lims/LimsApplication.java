package com.tentamus.lims;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/** The LIMS3 API in Java. It serves the features moved off the Node backend; the front end routes their calls here. */
@SpringBootApplication
public class LimsApplication {
    public static void main(String[] args) {
        SpringApplication.run(LimsApplication.class, args);
    }
}
