import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { db } from '../../db/db';
import type { Section, Textbook, Topic } from '../../db/types';

export interface StudyData {
  textbooks: Textbook[];
  sections: Section[];
  topics: Topic[];
  topicById: Map<string, Topic>;
  sectionById: Map<string, Section>;
  textbookById: Map<string, Textbook>;
  /** topics grouped by section in display order */
  grouped: { section: Section; topics: Topic[] }[];
  loaded: boolean;
}

export function useStudyData(): StudyData {
  const textbooks = useLiveQuery(() => db.textbooks.orderBy('order').toArray(), []);
  const sections = useLiveQuery(() => db.sections.orderBy('order').toArray(), []);
  const topics = useLiveQuery(() => db.topics.toArray(), []);

  return useMemo(() => {
    const tb = textbooks ?? [];
    const sec = sections ?? [];
    const top = (topics ?? []).slice().sort((a, b) => a.order - b.order);
    const grouped = sec.map((s) => ({ section: s, topics: top.filter((t) => t.sectionId === s.id) }));
    return {
      textbooks: tb,
      sections: sec,
      topics: top,
      topicById: new Map(top.map((t) => [t.id, t])),
      sectionById: new Map(sec.map((s) => [s.id, s])),
      textbookById: new Map(tb.map((t) => [t.id, t])),
      grouped,
      loaded: textbooks !== undefined && sections !== undefined && topics !== undefined,
    };
  }, [textbooks, sections, topics]);
}

export function TopicSelect({
  data,
  value,
  onChange,
  allowEmpty,
  emptyLabel = 'Select a topic…',
  className = 'input',
}: {
  data: StudyData;
  value: string;
  onChange: (id: string) => void;
  allowEmpty?: boolean;
  emptyLabel?: string;
  className?: string;
}) {
  return (
    <select className={className} value={value} onChange={(e) => onChange(e.target.value)}>
      {(allowEmpty || !value) && <option value="">{emptyLabel}</option>}
      {data.grouped.map((g) => (
        <optgroup key={g.section.id} label={g.section.name}>
          {g.topics.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
