package com.tentamus.lims.masterdata.domain;

import java.util.Map;

/**
 * An entry of the product category list or the compliance category list: a name is required. Replaces the database's
 * category name checks (migration 060).
 */
public final class Category extends MasterRecord {

    public Category(Map<String, Object> stored, Map<String, Object> changes) { super(stored, changes); }

    @Override
    public Map<String, Object> check(MasterFacts facts) {
        requireText("category_name", "Category name cannot be blank.");
        return values;
    }
}
