package com.tentamus.lims.core.jobs;

/**
 * The sensor feed (iMonnit) read every minute: each lab whose connection is on and whose last read is older than its
 * interval (the Node backend's sensor_feed.runDue). Implemented by the sensors feature as a Spring bean; until one exists,
 * the minute job does nothing.
 */
public interface SensorFeed {
    /** Reads every lab that is due; logs its own errors. */
    void runDue();
}
