import {audienceOptions, isAudience} from '../app/audience';
import {useWorkspace} from '../app/state';

export function AudienceSelect({label = 'Audience'}: {label?: string}) {
  const audience = useWorkspace(state => state.audience);
  const setAudience = useWorkspace(state => state.setAudience);
  return <label className="audience-select">
    <span>{label}</span>
    <select value={audience} onChange={event => {
      if (isAudience(event.target.value)) setAudience(event.target.value);
    }}>
      {audienceOptions.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
    </select>
  </label>;
}
