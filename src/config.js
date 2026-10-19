// Public connection details. The publishable key is meant to be public:
// what it may do is limited by the database's access rules (see supabase/schema.sql).
export const SUPABASE_URL = 'https://bgrbnocjdndsrovckias.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_5UJAoO1FFtZeTJ7NR7n5Qw_wqJWHsdC';
export const PHOTO_BUCKET = 'photos';

export const SECTIONS = [
  { key: 'salads_appetizers', name: 'Salads & Appetizers', kosherLabel: true },
  { key: 'soups', name: 'Soups', kosherLabel: true },
  { key: 'dairy_mains', name: 'Dairy Mains', note: 'Fish mains are here too' },
  { key: 'chicken_mains', name: 'Chicken Mains' },
  { key: 'meat_mains', name: 'Meat Mains' },
  { key: 'sides', name: 'Sides', kosherLabel: true },
  { key: 'desserts', name: 'Desserts', kosherLabel: true },
];

export const KOSHER_TYPES = [
  { key: 'meat', name: 'Meat' },
  { key: 'dairy', name: 'Dairy' },
  { key: 'pareve', name: 'Pareve' },
];
