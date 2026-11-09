package com.tentamus.lims.masterdata.service;

import com.tentamus.lims.core.access.AccessPolicy;
import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.core.db.UnitOfWork;
import com.tentamus.lims.core.signature.SignatureService;
import com.tentamus.lims.core.web.RequestContext;
import com.tentamus.lims.core.web.RuleException;
import com.tentamus.lims.masterdata.domain.ControlledList;
import com.tentamus.lims.masterdata.domain.MasterFacts;
import com.tentamus.lims.masterdata.repo.MasterDataRepository;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;

/**
 * Reading and saving any controlled list: one grid save is one transaction, signed when the list says so, and every
 * row passes its list's domain rules before it is written.
 */
@Service
public class ControlledListService {
    private final MasterDataRepository repo;
    private final UnitOfWork uow;
    private final SignatureService signatures;
    private final AccessPolicy access;

    public ControlledListService(MasterDataRepository repo, UnitOfWork uow, SignatureService signatures, AccessPolicy access) {
        this.repo = repo;
        this.uow = uow;
        this.signatures = signatures;
        this.access = access;
    }

    public List<Map<String, Object>> read(ControlledList list, Object... params) {
        return repo.read(list, params);
    }

    public List<Map<String, Object>> save(RequestContext ctx, ControlledList list, Map<String, Object> body, Map<String, Object> fixed) {
        return save(ctx, list, list.signing(), body, fixed);
    }

    /** Saves with the given signing (or none), for lists whose saves are signed only sometimes. */
    public List<Map<String, Object>> save(RequestContext ctx, ControlledList list, ControlledList.Signing signing, Map<String, Object> body,
                                          Map<String, Object> fixed) {
        List<Map<String, Object>> rows = rows(body);
        if (signing == null) return uow.run(ctx, d -> write(ctx, d, list, rows, fixed));
        return signatures.signed(ctx, body, new SignatureService.Meaning(signing.meaning(), signing.action(), signing.module()),
            d -> write(ctx, d, list, rows, fixed));
    }

    /**
     * The grid save of the Node backend's upsertRows: a row with an id updates the listed columns it carries, a row
     * without one is inserted; one {id} per row written (null when an updated row was not found).
     */
    private List<Map<String, Object>> write(RequestContext ctx, Db d, ControlledList list, List<Map<String, Object>> rows, Map<String, Object> fixed) {
        MasterFacts facts = repo.facts(d);
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> row : rows) {
            Map<String, Object> vals = list.writer().pick(row);
            if (row.get("id") != null) {
                if (vals.isEmpty()) continue;
                String id = row.get("id").toString();
                Map<String, Object> stored = list.rules() == null && list.keeper() == null ? null : repo.find(d, list, id);
                if (stored != null) mayChange(ctx, list, stored);
                if (stored != null && list.rules() != null) vals = list.rules().open(stored, vals).check(facts);
                out.add(list.writer().update(d, id, vals));
            } else {
                Map<String, Object> all = new LinkedHashMap<>(vals);
                all.putAll(fixed);
                mayChange(ctx, list, all);
                if (list.rules() != null) all = list.rules().open(null, all).check(facts);
                out.add(list.writer().insert(d, all, "id"));
            }
        }
        return out;
    }

    /** Refuses a row's write to someone who may not keep the list (row: the stored row on an update, the new one on an insert). */
    private void mayChange(RequestContext ctx, ControlledList list, Map<String, Object> row) {
        ControlledList.Keeper k = list.keeper();
        if (k == null) return;
        if (k.atLab()) access.requireAt(ctx, k.permission(), row == null || row.get("site_id") == null ? null : row.get("site_id").toString());
        else if (k.refusal() == null) access.requireToChange(ctx, list.table(), k.permission());
        else if (!access.has(ctx, k.permission())) throw RuleException.database(k.refusal());
    }

    @SuppressWarnings("unchecked")
    public static List<Map<String, Object>> rows(Map<String, Object> body) {
        Object r = body == null ? null : body.get("rows");
        return r instanceof List<?> l ? (List<Map<String, Object>>) l : List.of();
    }
}
