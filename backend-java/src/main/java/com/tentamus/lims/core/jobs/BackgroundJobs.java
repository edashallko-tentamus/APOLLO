package com.tentamus.lims.core.jobs;

import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.core.db.UnitOfWork;
import com.tentamus.lims.core.web.RequestContext;
import com.tentamus.lims.equipment.service.EquipmentService;
import com.tentamus.lims.packages.service.PackagesService;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * The server's own jobs (the Node backend's routes.startJobs), run as the System user: at start and every hour, automatic
 * equipment tag-outs, the stability pull orders due and the scheduled catalogue price changes; every minute, the sensor
 * feed. A failing job is logged and tried again at its next run.
 */
@Component
public class BackgroundJobs {
    private static final Logger log = LoggerFactory.getLogger(BackgroundJobs.class);
    private final Db db;
    private final UnitOfWork uow;
    private final EquipmentService equipment;
    private final PackagesService packages;
    private final ObjectProvider<SensorFeed> sensors;

    public BackgroundJobs(Db db, UnitOfWork uow, EquipmentService equipment, PackagesService packages, ObjectProvider<SensorFeed> sensors) {
        this.db = db;
        this.uow = uow;
        this.equipment = equipment;
        this.packages = packages;
        this.sensors = sensors;
    }

    @Scheduled(initialDelay = 0, fixedRate = 60 * 60 * 1000)
    public void hourly() {
        try {
            int n = 0;
            for (Map<String, Object> s : db.rows("SELECT id FROM lab_site")) n += equipment.autoTag((String) s.get("id"));
            if (n > 0) log.info("Equipment: {} automatic tag-out(s)", n);
        } catch (RuntimeException e) { log.error("Automatic tag-out failed: {}", e.getMessage()); }
        try {
            Map<String, Object> sys = db.one("SELECT id FROM app_user WHERE username = 'system'");
            if (sys != null) {
                Object n = uow.run(new RequestContext((String) sys.get("id"), null, "", "Stability pulls due today (hourly job)", "127.0.0.1"),
                    d -> d.one("SELECT create_due_stability_pulls(NULL) AS n").get("n"));
                if (n instanceof Number x && x.intValue() > 0) log.info("Stability: {} pull order(s) made", n);
            }
        } catch (RuntimeException e) { log.error("Stability pull orders failed: {}", e.getMessage()); }
        try {
            int n = packages.applyDue();
            if (n > 0) log.info("Catalogue: {} scheduled price change(s) applied", n);
        } catch (RuntimeException e) { log.error("Scheduled price changes failed: {}", e.getMessage()); }
    }

    @Scheduled(initialDelay = 60 * 1000, fixedRate = 60 * 1000)
    public void everyMinute() {
        try {
            sensors.ifAvailable(SensorFeed::runDue);
        } catch (RuntimeException e) { log.error("Sensor feed failed: {}", e.getMessage()); }
    }
}
