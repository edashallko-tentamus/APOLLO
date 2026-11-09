package com.tentamus.lims.core.db;

import com.tentamus.lims.core.web.RequestContext;
import java.util.function.Function;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * One transaction for one use case. It carries who is acting, why, and in which lab.
 *
 * <p>While the database still holds its GxP triggers (the transition), those triggers stamp, version and audit each
 * change from this context: it is set exactly as the Node backend sets it (lims.user_id, lims.reason, lims.site_id).
 * When a feature's triggers are removed, this class takes over stamping and audit writing for that feature.
 */
@Component
public class UnitOfWork {
    private final TransactionTemplate tx;
    private final Db db;

    public UnitOfWork(TransactionTemplate tx, Db db) {
        this.tx = tx;
        this.db = db;
    }

    public <T> T run(RequestContext ctx, Function<Db, T> work) {
        return run(ctx, ctx.reason(), work);
    }

    public <T> T run(RequestContext ctx, String reason, Function<Db, T> work) {
        return tx.execute(status -> {
            db.one("SELECT set_config('lims.user_id', ?, true), set_config('lims.reason', ?, true), set_config('lims.site_id', ?, true)",
                ctx.userId() == null ? "" : ctx.userId(), reason == null ? "" : reason, ctx.siteId() == null ? "" : ctx.siteId());
            return work.apply(db);
        });
    }
}
