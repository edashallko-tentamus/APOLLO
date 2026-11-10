// Canned reasons are kept per module (Admin > Canned reasons); the module comes from the page address
const RULES = [
  [/^#\/(orders|samples|intake|outbox)/, 'Orders'], [/^#\/(clients|contacts|licenses)/, 'Clients'], [/^#\/(projects|quote|print)/, 'Quotes'],
  [/^#\/(catalog|rush|analytes)/, 'Catalog'], [/^#\/inventory/, 'Inventory'], [/^#\/equipment/, 'Equipment'], [/^#\/purchasing/, 'Purchasing'],
  [/^#\/(methods|verification)/, 'Methods'], [/^#\/(logbooks|sensors)/, 'Logbooks'], [/^#\/billing/, 'Invoicing'], [/^#\/stability/, 'Stability'],
  [/^#\/trending/, 'Trending'], [/^#\/testing/, 'Testing'], [/^#\/reports/, 'Reports'], [/^#\/training/, 'Training'], [/^#\/admin/, 'Admin'],
];

export function moduleForPage(hash = window.location.hash) {
  const h = (hash || '#/').split('?')[0];
  return RULES.find(([re]) => re.test(h))?.[1] || 'General';
}
