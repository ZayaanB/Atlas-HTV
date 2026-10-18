import { useId, useState } from 'react';
import type { Article } from '@atlas/contracts';
import { providerNote } from '../../lib/presentation';
import { Icon } from '../../components/Icon';

export function NewsFeed({ articles, selectedId, onSelect }: {
  articles: readonly Article[]; selectedId: string | null; onSelect: (article: Article) => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const prefix = useId();
  return <ol className="news-list">{articles.map(article => {
    const note = providerNote(article);
    const expanded = expandedId === article.id;
    const headingId = `${prefix}-${article.id}-heading`;
    const detailsId = `${prefix}-${article.id}-details`;
    return <li key={article.id} className={`${selectedId === article.id ? 'selected' : ''} ${expanded ? 'is-open' : ''}`}>
      <h3><button id={headingId} className="headline news-toggle" aria-expanded={expanded} aria-controls={detailsId}
        onClick={() => setExpandedId(expanded ? null : article.id)}>
        <span className="news-headline-text">{article.title}</span>
        <span className="news-chevron"><Icon name="chevron" size={18} /></span>
      </button></h3>
      <div id={detailsId} className="news-details" hidden={!expanded} role="region" aria-labelledby={headingId}>
      <div className="article-meta">{article.publisher} · {article.published_at
        ? new Date(article.published_at).toLocaleString(undefined, { timeZone: 'UTC', timeZoneName: 'short' })
        : article.published_date ? `${article.published_date} (date only)` : 'Publication time unavailable'}</div>
      {article.excerpt && <p>{article.excerpt}</p>}
      <p className="muted">{article.geographic_precision ?? (article.location_ids.length && article.verification_status === 'unreviewed'
        ? 'Provider-reported location, not reviewed' : 'Geography not verified')} · {article.verification_status}
        {article.themes.length > 0 && ` · ${article.themes.join(', ')}`}</p>
      {note && <p className="muted">{note}</p>}
      <div className="news-details-actions">
        <button className="text-button" onClick={() => onSelect(article)}>Open article <Icon name="arrow" size={15} /></button>
        <a href={article.url} target="_blank" rel="noopener noreferrer">Read original source <span aria-hidden="true">↗</span></a>
      </div>
      </div>
    </li>;
  })}</ol>;
}
