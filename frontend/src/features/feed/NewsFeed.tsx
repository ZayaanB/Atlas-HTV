import type { Article } from '@atlas/contracts';
import { providerNote } from '../../lib/presentation';

export function NewsFeed({ articles, selectedId, onSelect }: {
  articles: readonly Article[]; selectedId: string | null; onSelect: (article: Article) => void;
}) {
  return <ol className="news-list">{articles.map(article => {
    const note = providerNote(article);
    return <li key={article.id} className={selectedId === article.id ? 'selected' : ''}>
      <div className="article-meta">{article.publisher} · {article.published_at
        ? new Date(article.published_at).toLocaleString(undefined, { timeZone: 'UTC', timeZoneName: 'short' })
        : article.published_date ? `${article.published_date} (date only)` : 'Publication time unavailable'}</div>
      <h3><button className="headline" aria-pressed={selectedId === article.id} onClick={() => onSelect(article)}>{article.title}</button></h3>
      {article.excerpt && <p>{article.excerpt}</p>}
      <p className="muted">{article.geographic_precision ?? (article.location_ids.length && article.verification_status === 'unreviewed'
        ? 'Provider-reported location, not reviewed' : 'Geography not verified')} · {article.verification_status}
        {article.themes.length > 0 && ` · ${article.themes.join(', ')}`}</p>
      {note && <p className="muted">{note}</p>}
      <a href={article.url} target="_blank" rel="noopener noreferrer">Read original source <span aria-hidden="true">↗</span></a>
    </li>;
  })}</ol>;
}
