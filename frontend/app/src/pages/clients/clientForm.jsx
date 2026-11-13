// The New client / Edit client dialog (clients list and client page), and the license helpers both pages share
export function clientForm(dialogs, meta, c, allClients) {
  const en = meta?.enums || {};
  return dialogs.form({
    title: c.id ? 'Edit client' : 'New client', okText: c.id ? 'Continue' : 'Create',
    fields: [
      { name: 'legal_name', label: 'Legal name', required: true, value: c.legal_name },
      { name: 'display_name', label: 'Display name', value: c.display_name },
      { name: 'parent_client_id', label: 'Parent client', type: 'select', value: c.parent_client_id,
        options: allClients.filter((x) => x.id !== c.id).map((x) => ({ value: x.id, label: x.legal_name })) },
      { name: 'account_status', label: 'Account status', type: 'select', blank: false, value: c.account_status || 'Active', options: en.account_status || [],
        help: 'On Hold: samples can be logged and tested, reports cannot be released. Inactive: no new orders.' },
      { name: 'is_gmp_client', label: 'Regulated (GMP) client', type: 'checkbox', value: c.is_gmp_client, cbLabel: 'GMP client (strict OOS procedure, e-signed chain of custody)' },
      { name: 'allow_partial_reports', label: 'Partial reports', type: 'checkbox', value: c.allow_partial_reports !== false, cbLabel: 'Send a COA version as each test is finalized (otherwise one COA when the last test is finalized)' },
      { name: 'billing_address', label: 'Billing address', value: c.billing_address },
      { name: 'site_address', label: 'Site address', value: c.site_address },
      { name: 'default_report_delivery', label: 'Default report delivery', type: 'select', value: c.default_report_delivery, options: en.report_delivery || [] },
    ],
  });
}

export const day = (v) => (v ? String(v).slice(0, 10) : '');
export const licenseStateCls = (s) => (s === 'Expired' ? 'tbfail' : s === 'Expiring soon' ? 'flag' : '');
