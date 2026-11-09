// The menu, in sections (same as the current app's main.js). [address, label, permission codes (any one shows it)].
// A heading shows only when at least one of its items does. Section colour keys match the shared stylesheet (data-sec).
export const NAV = [
  { items: [['#/', 'Home'], ['#/dashboard/gm', 'GM dashboard', ['dashboard.gm']], ['#/dashboard/executive', 'Executive dashboard', ['dashboard.executive']],
    ['#/dashboard/finance', 'Finance figures', ['finance.enter']]] },
  { head: 'Intake', items: [['#/orders', 'Lab orders'], ['#/intake', 'Intake dashboard'], ['#/clients', 'Clients'], ['#/licenses', 'Client licenses'], ['#/contacts', 'Contacts'], ['#/outbox', 'Outbox']] },
  { head: 'Testing', items: [['#/testing', 'Backlog'], ['#/testing/batches?show=mine', 'My worklist'], ['#/testing/batches', 'Batches'], ['#/testing/batches?show=review', 'QC Review'], ['#/reports/finalization', 'Report Finalization', ['reports.finalize']],
    ['#/oos', 'OOS investigations', ['oos.open', 'oos.approve', 'testing.review', 'reports.finalize']], ['#/stability/studies', 'Stability studies'], ['#/logbooks', 'Logbooks'], ['#/trending', 'Trending', ['trending.view']], ['#/training', 'Training and competency']] },
  { head: 'Lab supplies', items: [['#/inventory', 'Inventory'], ['#/purchasing', 'Purchasing'], ['#/equipment', 'Equipment']] },
  { head: 'Pricing', items: [['#/quotes', 'Quotes'], ['#/stability/quotes', 'Stability quotes'], ['#/projects', 'Projects'], ['#/rush', 'Rush fee schedules']] },
  { head: 'Billing', items: [['#/billing', 'Ready to invoice', ['invoicing.view', 'invoicing.issue']], ['#/billing?tab=mine', 'My draft invoices', ['invoicing.issue']],
    ['#/billing?tab=issued', 'Invoices', ['invoicing.view', 'invoicing.issue']]] },
];

export const ADMIN_NAV = [
  { head: 'Tests and workflows', items: [['#/methods', 'Tests and workflows'], ['#/catalog', 'Test catalogue'], ['#/analytes', 'Analytes'],
    ['#/admin/units', 'Units', ['master.units']], ['#/admin/conversions', 'Unit conversions', ['master.units']], ['#/admin/matrices', 'Matrices', ['master.matrices', 'master.compliance']]] },
  { head: 'QA', items: [['#/logbooks/review', 'Logbook review', ['logbook.review']], ['#/admin/reasons', 'Canned reasons', ['master.reasons']], ['#/oos/config', 'OOS checklists', ['oos.configure']], ['#/audit', 'Audit trail']] },
  { head: 'Personnel', items: [['#/admin/users', 'People and groups', ['admin.users']], ['#/admin/dashboard-widgets', 'Dashboard widgets', ['admin.groups']], ['#/admin/groups', 'Groups and permissions', ['admin.groups', 'admin.users', 'audit.view']],
    ['#/admin/permissions', 'Permission matrix', ['admin.groups', 'admin.users', 'audit.view']]] },
  { head: 'Lab setup', items: [['#/admin/sites', 'Sites and holidays', ['admin.lab']], ['#/admin/report-templates', 'Report templates', ['reports.templates', 'admin.lab']], ['#/admin/waste', 'Waste classifications', ['inventory.lists', 'admin.lab']], ['#/stability/setup', 'Stability chambers', ['stability.configure', 'admin.lab']], ['#/sensors', 'Sensors', ['sensors.configure', 'logbook.review', 'admin.lab']]] },
];

export const SECTION_KEY = { Intake: 'intake', Testing: 'testing', 'Lab supplies': 'supplies', Pricing: 'pricing', Billing: 'pricing' };
