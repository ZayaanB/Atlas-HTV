// Discovery categories, not verified article classifications. English metadata matching
// deliberately does not infer geography, event dates, impact, or source reliability.
export const eventTypeIds = ['flood', 'earthquake', 'cyclone', 'drought', 'wildfire', 'volcano', 'tsunami'] as const;
export const topicIds = ['politics', 'business', 'technology', 'health', 'science', 'environment', 'infrastructure'] as const;
export const newsCategories = [
  {field:'event_types',id:'flood',label:'Floods',terms:['flood','floods','flooding','floodwaters'],themes:['flooding']},
  {field:'event_types',id:'earthquake',label:'Earthquakes',terms:['earthquake','earthquakes','seismic'],themes:[]},
  {field:'event_types',id:'cyclone',label:'Cyclones & storms',terms:['hurricane','hurricanes','cyclone','cyclones','typhoon','typhoons','tropical storm'],themes:['hurricanes']},
  {field:'event_types',id:'drought',label:'Droughts',terms:['drought','droughts'],themes:[]},
  {field:'event_types',id:'wildfire',label:'Wildfires',terms:['wildfire','wildfires','forest fire','forest fires'],themes:[]},
  {field:'event_types',id:'volcano',label:'Volcanoes',terms:['volcano','volcanoes','volcanic','eruption','eruptions'],themes:[]},
  {field:'event_types',id:'tsunami',label:'Tsunamis',terms:['tsunami','tsunamis'],themes:[]},
  {field:'topics',id:'politics',label:'Politics & policy',terms:['election','elections','parliament','congress','legislation','diplomacy','government','policy'],themes:[]},
  {field:'topics',id:'business',label:'Business & markets',terms:['economy','economic','inflation','stock market','markets','investor','investors','trade','bank','banking','earnings'],themes:[]},
  {field:'topics',id:'technology',label:'Technology',terms:['technology','artificial intelligence','software','semiconductor','cybersecurity','tech'],themes:[]},
  {field:'topics',id:'health',label:'Health',terms:['health','hospital','hospitals','disease','outbreak','vaccine','vaccines','drinking water','boil water'],themes:['drinking-water']},
  {field:'topics',id:'science',label:'Science & space',terms:['science','scientific','research','nasa','space','satellite','satellites'],themes:['river-monitoring']},
  {field:'topics',id:'environment',label:'Environment & climate',terms:['climate','environment','environmental','flood','floods','flooding','hurricane','cyclone','drought','wildfire','earthquake','volcanic','tsunami','glacier','glaciers'],themes:['flooding','hurricanes','river-monitoring']},
  {field:'topics',id:'infrastructure',label:'Infrastructure & energy',terms:['infrastructure','bridge','bridges','road','roads','power','electricity','energy','water system','water systems'],themes:['infrastructure','drinking-water']},
] as const;

const tokens = (value: unknown) => typeof value === 'string' ? value.toLowerCase().replace(/[^a-z0-9]+/g, ' ') : '';
const list = (value: unknown): string[] => Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
export function matchesNewsCategories(article: Record<string, unknown>, query: Record<string, unknown>): boolean {
  const text = ` ${tokens(`${typeof article.title === 'string' ? article.title : ''} ${typeof article.excerpt === 'string' ? article.excerpt : ''}`)} `;
  for (const field of ['event_types', 'topics'] as const) {
    const requested = list(query[field]);
    if (requested.length && !newsCategories.some(rule => rule.field === field && requested.includes(rule.id) &&
      (rule.themes.some(theme => list(article.themes).includes(theme)) || rule.terms.some(term => text.includes(` ${term} `))))) return false;
  }
  if (query.verification_status !== undefined && article.verification_status !== query.verification_status) return false;
  if (query.has_location !== undefined && (list(article.location_ids).length > 0) !== query.has_location) return false;
  return true;
}
export const newsFiltering = {categories: newsCategories, matches: matchesNewsCategories};
