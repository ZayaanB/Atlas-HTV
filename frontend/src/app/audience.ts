import type {AssistantRequest, InvestigationResponse} from '@atlas/contracts';

// Workspace preference only. Wire values still come from AssistantRequest.
export type Audience = NonNullable<AssistantRequest['audience']> | 'community_organization';
type BriefKind = InvestigationResponse['investigation']['items'][number]['kind'];
export const audienceOptions = [
  {id:'general_public',label:'General public',emphasis:'Local events, public impacts, and resources'},
  {id:'journalist',label:'Journalist',emphasis:'Sources, timelines, and unanswered questions'},
  {id:'community_organization',label:'Community organization',emphasis:'Service access, infrastructure, and community impacts'},
  {id:'investor',label:'Investor',emphasis:'Documented exposure and research uncertainties'},
] as const;
export const audienceProfiles: Record<Audience,{questions:readonly string[];sections:readonly BriefKind[]}> = {
  general_public: {
    questions:['What local events and public impacts do these sources describe?','Which relevant public resources are documented?','What is confirmed, and what remains uncertain?'],
    sections:['what_happened','public_impact','resource','uncertainty','research_question','business_exposure'],
  },
  journalist: {
    questions:['What timeline do the sources establish?','Where do reports conflict or leave unanswered questions?','Which original sources should a journalist examine next?'],
    sections:['research_question','uncertainty','what_happened','public_impact','resource','business_exposure'],
  },
  community_organization: {
    questions:['What service-access or infrastructure gaps are documented?','Which community impacts are supported by the sources?','What resources are documented, and what needs further research?'],
    sections:['public_impact','resource','uncertainty','what_happened','research_question','business_exposure'],
  },
  investor: {
    questions:['Which company or sector exposures are documented by sources?','What uncertainties limit this exposure research?','Which public impacts and infrastructure dependencies are documented?'],
    sections:['business_exposure','uncertainty','public_impact','what_happened','research_question','resource'],
  },
};
export const isAudience = (value: unknown): value is Audience => audienceOptions.some(option => option.id === value);
// The current backend has no community_organization enum. Do not send an unsupported value.
export const assistantAudience = (audience: Audience): NonNullable<AssistantRequest['audience']> =>
  audience === 'community_organization' ? 'general_public' : audience;

export const AUDIENCE_STORAGE_KEY = 'atlas.audience.v1';
export function readAudiencePreference(): {audience:Audience;onboardingComplete:boolean;audienceStorageAvailable:boolean} {
  const fallback = {audience:'general_public' as const,onboardingComplete:false,audienceStorageAvailable:true};
  let raw: string | null;
  try {raw = localStorage.getItem(AUDIENCE_STORAGE_KEY);}
  catch {return {...fallback,audienceStorageAvailable:false};}
  if (!raw || raw.length > 2048) return fallback;
  try {
    const saved: unknown = JSON.parse(raw);
    if (saved && typeof saved === 'object' && 'audience' in saved && 'onboardingComplete' in saved &&
      saved.onboardingComplete === true && isAudience(saved.audience))
      return {audience:saved.audience,onboardingComplete:true,audienceStorageAvailable:true};
  } catch { /* Invalid local preferences fall back to a fresh, general-public visit. */ }
  return fallback;
}
export function writeAudiencePreference(audience: Audience): boolean {
  try {localStorage.setItem(AUDIENCE_STORAGE_KEY,JSON.stringify({audience,onboardingComplete:true})); return true;}
  catch {return false;}
}
