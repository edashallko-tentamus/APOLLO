package com.tentamus.lims.masterdata.service;

import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.core.db.UnitOfWork;
import com.tentamus.lims.core.signature.SignatureService;
import com.tentamus.lims.core.web.RequestContext;
import com.tentamus.lims.masterdata.domain.ControlledList;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;

/** Reading and saving any controlled list: one grid save is one transaction, signed when the list says so. */
@Service
public class ControlledListService {
    private final Db db;
    private final UnitOfWork uow;
    private final SignatureService signatures;

    public ControlledListService(Db db, UnitOfWork uow, SignatureService signatures) {
        this.db = db;
        this.uow = uow;
        this.signatures = signatures;
    }

    public List<Map<String, Object>> read(ControlledList list, Object... params) {
        return db.rows(list.select(), params);
    }

    public List<Map<String, Object>> save(RequestContext ctx, ControlledList list, Map<String, Object> body, Map<String, Object> fixed) {
        return save(ctx, list, list.signing(), body, fixed);
    }

    /** Saves with the given signing (or none), for lists whose saves are signed only sometimes. */
    public List<Map<String, Object>> save(RequestContext ctx, ControlledList list, ControlledList.Signing signing, Map<String, Object> body,
                                          Map<String, Object> fixed) {
        List<Map<String, Object>> rows = rows(body);
        if (signing == null) return uow.run(ctx, d -> list.writer().upsert(d, rows, fixed));
        return signatures.signed(ctx, body, new SignatureService.Meaning(signing.meaning(), signing.action(), signing.module()),
            d -> list.writer().upsert(d, rows, fixed));
    }

    @SuppressWarnings("unchecked")
    public static List<Map<String, Object>> rows(Map<String, Object> body) {
        Object r = body == null ? null : body.get("rows");
        return r instanceof List<?> l ? (List<Map<String, Object>>) l : List.of();
    }
}
