package com.tentamus.lims.quotes.service;

import com.tentamus.lims.core.db.UnitOfWork;
import com.tentamus.lims.core.paging.PagedList;
import com.tentamus.lims.core.web.RequestContext;
import com.tentamus.lims.core.web.RuleException;
import com.tentamus.lims.quotes.repo.ProjectRepository;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;

/**
 * Projects (reusable quoted test packages) and the version pages they share with quotes: the lines, rush terms, analyte
 * choices and status. Quoting rules (lines locked once quoted, list price snapshots, discounts kept when analytes are
 * removed) are still enforced by the database.
 */
@Service
public class ProjectService {
    private final ProjectRepository repo;
    private final UnitOfWork uow;

    public ProjectService(ProjectRepository repo, UnitOfWork uow) {
        this.repo = repo;
        this.uow = uow;
    }

    public Object list(Map<String, String> query) { return PagedList.wanted(query) ? repo.page(query) : repo.projects(); }

    /** A new project, with its first (Draft) version. */
    public Map<String, Object> create(RequestContext ctx, Map<String, Object> row) {
        return uow.run(ctx, d -> {
            Map<String, Object> p = ProjectRepository.NEW_PROJECT.upsert(d, List.of(row), Map.of()).get(0);
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("id", p.get("id"));
            out.put("version_id", repo.newVersion(d, p.get("id")).get("id"));
            return out;
        });
    }

    public List<Map<String, Object>> update(RequestContext ctx, String id, Map<String, Object> row) {
        return uow.run(ctx, d -> ProjectRepository.PROJECT.upsert(d, List.of(withId(row, id)), Map.of()));
    }

    public Map<String, Object> detail(String id) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("project", repo.project(id));
        out.put("versions", repo.versionsOf(id));
        return out;
    }

    public Map<String, Object> newVersion(RequestContext ctx, String projectId) {
        return uow.run(ctx, d -> repo.newVersion(d, projectId));
    }

    /** A quote or project version's page: the version, its lines, rush terms, the client's contacts and the catalogue. */
    public Map<String, Object> version(String vid) {
        Map<String, Object> v = repo.version(vid);
        if (v == null) throw new RuleException("Quote version not found");
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("version", v);
        out.put("lines", repo.lines(vid));
        out.put("rush", repo.rushTerms(vid));
        out.put("contacts", repo.clientContacts(v.get("client_id")));
        out.put("catalog", repo.activeCatalogue());
        return out;
    }

    public List<Map<String, Object>> updateVersion(RequestContext ctx, String vid, Map<String, Object> row) {
        return uow.run(ctx, d -> ProjectRepository.VERSION.upsert(d, List.of(withId(row, vid)), Map.of()));
    }

    /** Status changes (issue, accept, reject...): the body itself carries status, valid_until, accepted_by_contact_id. */
    public List<Map<String, Object>> setStatus(RequestContext ctx, String vid, Map<String, Object> body) {
        Map<String, Object> row = new LinkedHashMap<>();
        for (String k : List.of("status", "valid_until", "accepted_by_contact_id")) if (body.containsKey(k)) row.put(k, body.get(k));
        row.put("id", vid);
        return uow.run(ctx, d -> ProjectRepository.VERSION_STATUS.upsert(d, List.of(row), Map.of()));
    }

    public List<Map<String, Object>> saveLines(RequestContext ctx, String vid, List<Map<String, Object>> rows, boolean prefill) {
        return uow.run(ctx, d -> {
            List<Map<String, Object>> out = ProjectRepository.LINES.upsert(d, rows, Map.of("project_version_id", vid));
            if (prefill) {
                List<String> ids = new ArrayList<>();
                for (Map<String, Object> r : out) if (r != null && RequestContext.isUuid(r.get("id"))) ids.add(r.get("id").toString());
                if (!ids.isEmpty()) repo.prefill(d, ids);
            }
            return out;
        });
    }

    public List<Map<String, Object>> saveRushTerms(RequestContext ctx, List<Map<String, Object>> rows) {
        return uow.run(ctx, d -> ProjectRepository.RUSH_TERMS.upsert(d, rows, Map.of()));
    }

    public List<Map<String, Object>> analyteChoices(String lineId) { return repo.analyteChoices(lineId); }

    public List<Map<String, Object>> saveAnalyteChoices(RequestContext ctx, List<Map<String, Object>> rows) {
        return uow.run(ctx, d -> ProjectRepository.ANALYTE_CHOICES.upsert(d, rows, Map.of()));
    }

    private static Map<String, Object> withId(Map<String, Object> row, String id) {
        Map<String, Object> r = new LinkedHashMap<>(row == null ? Map.of() : row);
        r.put("id", id);
        return r;
    }
}
