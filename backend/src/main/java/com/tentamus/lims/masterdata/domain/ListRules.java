package com.tentamus.lims.masterdata.domain;

import java.util.Map;

/** Makes a list's domain record from the stored row (null when new) and the values a save brings. */
@FunctionalInterface
public interface ListRules {
    MasterRecord open(Map<String, Object> stored, Map<String, Object> changes);
}
