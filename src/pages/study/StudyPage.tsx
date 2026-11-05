import { useLiveQuery } from 'dexie-react-hooks';
import { useSearchParams } from 'react-router-dom';
import { db } from '../../db/db';
import { PageHeader, Tabs } from '../../components/ui';
import { todayStr } from '../../lib/utils';
import Essays from './Essays';
import Progress from './Progress';
import QuestionBank from './QuestionBank';
import Quiz, { type QuizMode } from './Quiz';
import TextbookManager from './TextbookManager';
import TopicMap from './TopicMap';
import { useStudyData } from './useStudyData';

type Tab = 'topics' | 'questions' | 'quiz' | 'essays' | 'progress' | 'textbooks';
const TABS: Tab[] = ['topics', 'questions', 'quiz', 'essays', 'progress', 'textbooks'];

export default function StudyPage() {
  const [params, setParams] = useSearchParams();
  const tabParam = params.get('tab') as Tab | null;
  const tab: Tab = tabParam && TABS.includes(tabParam) ? tabParam : 'topics';
  const mode = (params.get('mode') as QuizMode | null) ?? 'due';
  const data = useStudyData();
  const today = todayStr();
  const due = useLiveQuery(() => db.questions.where('srs.due').belowOrEqual(today).count(), [today]);

  return (
    <div>
      <PageHeader title="Study" subtitle="Cover every topic through questions, spaced review and essay practice." />
      <Tabs
        value={tab}
        onChange={(t) => setParams({ tab: t }, { replace: true })}
        tabs={[
          { id: 'topics', label: 'Topic map' },
          { id: 'questions', label: 'Question bank' },
          { id: 'quiz', label: 'Quiz', badge: due || undefined },
          { id: 'essays', label: 'Essays' },
          { id: 'progress', label: 'Progress' },
          { id: 'textbooks', label: 'Textbooks' },
        ]}
      />
      {!data.loaded ? null : (
        <>
          {tab === 'topics' && <TopicMap data={data} />}
          {tab === 'questions' && <QuestionBank data={data} />}
          {tab === 'quiz' && <Quiz key={mode} data={data} initialMode={mode} />}
          {tab === 'essays' && <Essays data={data} />}
          {tab === 'progress' && <Progress data={data} />}
          {tab === 'textbooks' && <TextbookManager data={data} />}
        </>
      )}
    </div>
  );
}
