package com.tentamus.lims.clients.service;

import com.tentamus.lims.clients.domain.ClientLicense;
import com.tentamus.lims.clients.repo.LicenseRepository;
import com.tentamus.lims.core.access.AccessPolicy;
import com.tentamus.lims.core.db.UnitOfWork;
import com.tentamus.lims.core.files.DocumentStore;
import com.tentamus.lims.core.files.StoredFile;
import com.tentamus.lims.core.time.LabClock;
import com.tentamus.lims.core.web.RequestContext;
import com.tentamus.lims.core.web.RuleException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Service;

/** The license use cases: add, correct or retire, the scanned copy, and the list of every active license by urgency. */
@Service
public class LicenseService {
    private static final long MAX_FILE = 10L * 1024 * 1024;
    private static final Set<String> FILE_TYPES = Set.of("application/pdf", "image/png", "image/jpeg");
    private final LicenseRepository licenses;
    private final DocumentStore documents;
    private final AccessPolicy access;
    private final LabClock clock;
    private final UnitOfWork uow;

    public LicenseService(LicenseRepository licenses, DocumentStore documents, AccessPolicy access, LabClock clock, UnitOfWork uow) {
        this.licenses = licenses;
        this.documents = documents;
        this.access = access;
        this.clock = clock;
        this.uow = uow;
    }

    /** POST /api/clients/:id/licenses. Returns {id, license_code}. */
    public Map<String, Object> add(RequestContext ctx, String clientId, Map<String, Object> body) {
        if (!RequestContext.isUuid(clientId)) throw new RuleException("Client not found");
        Object reason = body.get("reason");
        return uow.run(ctx, reason == null || "".equals(reason) ? "License added" : reason.toString(), db -> {
            String doc = storeCopy(body.get("document"));
            Map<String, Object> vals = new LinkedHashMap<>();
            vals.put("client_id", clientId);
            for (String k : ClientLicense.FIELDS) vals.put(k, "".equals(body.get(k)) ? null : body.get(k));
            vals.put("document_id", doc);
            access.requireToChange(ctx, "client_license", ClientService.PERMISSION);
            Map<String, Object> after = new LinkedHashMap<>(vals);
            Map<String, Object> row = ClientLicense.checked(null, after, vals);
            return licenses.writer().insert(db, row, "id, license_code");
        });
    }

    /** PUT /api/licenses/:id: a correction (reason), or retiring (reason and why); a new scanned copy may be attached. */
    public Map<String, Object> update(RequestContext ctx, String id, Map<String, Object> body) {
        if (!RequestContext.isUuid(id)) throw new RuleException("License not found");
        return uow.run(ctx, db -> {
            Map<String, Object> vals = new LinkedHashMap<>();
            for (String k : ClientLicense.FIELDS) if (body.containsKey(k)) vals.put(k, "".equals(body.get(k)) ? null : body.get(k));
            if (truthy(body.get("retire"))) { vals.put("status", "Retired"); vals.put("retired_reason", body.get("retired_reason") == null ? "" : body.get("retired_reason")); }
            String doc = storeCopy(body.get("document"));
            if (doc != null) vals.put("document_id", doc);
            if (vals.isEmpty()) return Map.of("ok", true);
            access.requireToChange(ctx, "client_license", ClientService.PERMISSION);
            Map<String, Object> before = licenses.find(id);
            if (before != null) {
                Map<String, Object> after = new LinkedHashMap<>(before);
                after.putAll(vals);
                vals = ClientLicense.checked(before, after, vals);
            }
            licenses.writer().update(db, id, vals);
            return Map.of("ok", true);
        });
    }

    /** GET /api/licenses/:id/file: the scanned copy. */
    public org.springframework.http.ResponseEntity<byte[]> file(String id) {
        if (!RequestContext.isUuid(id)) throw new RuleException("License not found");
        Map<String, Object> f = licenses.fileInfo(id);
        if (f == null) throw new RuleException("No scanned copy on this license");
        return new StoredFile(licenses.fileBytes(id), (String) f.get("mime_type"), (String) f.get("file_name")).response();
    }

    /** GET /api/licenses: every active license, judged on the lab's date. */
    public Map<String, Object> list(RequestContext ctx) {
        List<Map<String, Object>> rows = licenses.active(clock.today(ctx.siteId()));
        return Map.of("rows", rows);
    }

    private String storeCopy(Object document) {
        DocumentStore.Upload u = DocumentStore.Upload.from(document);
        return u == null ? null : documents.store(u, MAX_FILE, FILE_TYPES, "The scanned copy must be a file under 10 MB",
            "The scanned copy must be a PDF, PNG or JPEG", "license");
    }

    /** JavaScript truthiness for a flag sent by the screen. */
    private static boolean truthy(Object v) {
        return v != null && !Boolean.FALSE.equals(v) && !"".equals(v) && !(v instanceof Number n && n.doubleValue() == 0);
    }
}
