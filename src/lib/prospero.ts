/**
 * Master PROSPERO-style systematic review protocol template.
 * This definition is read-only; protocols store only field values keyed by `key`.
 */

export type FieldKind = 'text' | 'textarea' | 'date' | 'select';

export interface ProsperoField {
  key: string;
  label: string;
  hint: string;
  kind: FieldKind;
  options?: string[];
}

export interface ProsperoGroup {
  title: string;
  fields: ProsperoField[];
}

export const PROSPERO_TEMPLATE: ProsperoGroup[] = [
  {
    title: 'Review title and timescale',
    fields: [
      { key: 'title', label: 'Review title', kind: 'text', hint: 'A concise title that states the intervention/exposure, population and outcome. Include "systematic review" (and "meta-analysis" if planned).' },
      { key: 'startDate', label: 'Anticipated start date', kind: 'date', hint: 'When you expect to begin formal screening of search results.' },
      { key: 'completionDate', label: 'Anticipated completion date', kind: 'date', hint: 'When you expect the review to be complete (data analysis and write-up finished).' },
      { key: 'stage', label: 'Stage of review', kind: 'select', options: ['Not started', 'Preliminary searches', 'Piloting of study selection', 'Formal screening of search results', 'Data extraction', 'Risk of bias assessment', 'Data analysis', 'Completed'], hint: 'Which stage has the review reached at the time of registration? PROSPERO normally requires registration before data extraction starts.' },
    ],
  },
  {
    title: 'Review team details',
    fields: [
      { key: 'contactName', label: 'Named contact', kind: 'text', hint: 'The person responsible for the review and for correspondence about it.' },
      { key: 'contactEmail', label: 'Named contact email', kind: 'text', hint: 'An institutional email address for the named contact.' },
      { key: 'affiliation', label: 'Organisational affiliation', kind: 'text', hint: 'The institution(s) the review is affiliated with, with country.' },
      { key: 'team', label: 'Review team members', kind: 'textarea', hint: 'List each member: full name, role, and affiliation. One per line.' },
      { key: 'funding', label: 'Funding sources / sponsors', kind: 'textarea', hint: 'Name any funders and grant numbers. State "None" if unfunded.' },
      { key: 'conflicts', label: 'Conflicts of interest', kind: 'textarea', hint: 'Declare any actual or potential conflicts for any team member, or state "None known".' },
      { key: 'collaborators', label: 'Collaborators', kind: 'textarea', hint: 'People who contribute but are not part of the core review team (e.g. librarian, statistician).' },
    ],
  },
  {
    title: 'Review methods',
    fields: [
      { key: 'question', label: 'Review question', kind: 'textarea', hint: 'State the question(s) clearly, ideally in PICO/PECO format.' },
      { key: 'searches', label: 'Searches', kind: 'textarea', hint: 'Databases to be searched (e.g. MEDLINE, Embase, CENTRAL), date ranges, language or publication restrictions, and grey literature / trial registries / reference checking.' },
      { key: 'searchStrategyLink', label: 'URL to search strategy', kind: 'text', hint: 'Link to (or note where to find) the full search strategy for at least one database.' },
      { key: 'condition', label: 'Condition or domain being studied', kind: 'textarea', hint: 'Briefly describe the disease, condition or healthcare domain.' },
      { key: 'participants', label: 'Participants / population', kind: 'textarea', hint: 'Inclusion and exclusion criteria for the population (age, diagnosis criteria, setting).' },
      { key: 'intervention', label: 'Intervention(s), exposure(s)', kind: 'textarea', hint: 'What interventions or exposures will be included and excluded.' },
      { key: 'comparator', label: 'Comparator(s) / control', kind: 'textarea', hint: 'What the intervention will be compared with (placebo, active treatment, no treatment).' },
      { key: 'studyTypes', label: 'Types of study to be included', kind: 'textarea', hint: 'Eligible study designs (e.g. RCTs, cohort, case-control) and any designs excluded.' },
      { key: 'context', label: 'Context', kind: 'textarea', hint: 'Any setting-related criteria (e.g. primary care, specific countries).' },
      { key: 'mainOutcomes', label: 'Main outcome(s)', kind: 'textarea', hint: 'Primary outcomes, including timing of measurement and effect measures (e.g. risk ratio, mean difference).' },
      { key: 'additionalOutcomes', label: 'Additional outcome(s)', kind: 'textarea', hint: 'Secondary outcomes, with timing and effect measures. State "None" if not applicable.' },
      { key: 'dataExtraction', label: 'Data extraction (selection and coding)', kind: 'textarea', hint: 'How records will be screened (number of reviewers, independence, disagreement resolution) and what data will be extracted, using what tool.' },
      { key: 'riskOfBias', label: 'Risk of bias (quality) assessment', kind: 'textarea', hint: 'Tool(s) to be used (e.g. RoB 2, ROBINS-I, Newcastle–Ottawa) and how assessments will be used.' },
      { key: 'synthesis', label: 'Strategy for data synthesis', kind: 'textarea', hint: 'Planned narrative and/or quantitative synthesis; model (fixed/random effects), heterogeneity assessment, software, and certainty grading (e.g. GRADE).' },
      { key: 'subgroups', label: 'Analysis of subgroups or subsets', kind: 'textarea', hint: 'Any planned subgroup or sensitivity analyses. State "None planned" if not applicable.' },
    ],
  },
  {
    title: 'General information',
    fields: [
      { key: 'reviewType', label: 'Type and method of review', kind: 'textarea', hint: 'e.g. Intervention review, diagnostic accuracy, prognostic, network meta-analysis; health area of the review.' },
      { key: 'language', label: 'Language', kind: 'text', hint: 'Language in which the review will be written / published.' },
      { key: 'country', label: 'Country', kind: 'text', hint: 'Country (or countries) where the review is being carried out.' },
      { key: 'otherRegistration', label: 'Other registration details', kind: 'textarea', hint: 'Any other registry where this protocol is registered, with ID.' },
      { key: 'publishedProtocol', label: 'Reference / URL for published protocol', kind: 'text', hint: 'Citation or link if the protocol has been published (e.g. in a journal or on OSF).' },
      { key: 'dissemination', label: 'Dissemination plans', kind: 'textarea', hint: 'Planned outputs: journal publication, conference presentation, patient summaries, etc.' },
      { key: 'keywords', label: 'Keywords', kind: 'text', hint: 'Comma-separated keywords that will help others find the review.' },
      { key: 'existingReviews', label: 'Details of existing review of same topic by same authors', kind: 'textarea', hint: 'Reference any previous review on the same topic by this team, or state "None".' },
      { key: 'status', label: 'Current review status', kind: 'select', options: ['Planning', 'Ongoing', 'Completed but not published', 'Completed and published', 'Discontinued'], hint: 'The overall status of the review.' },
      { key: 'additionalInfo', label: 'Additional information', kind: 'textarea', hint: 'Anything else relevant that does not fit elsewhere.' },
    ],
  },
];

export const PROSPERO_FIELDS: ProsperoField[] = PROSPERO_TEMPLATE.flatMap((g) => g.fields);

export function completionPct(fields: Record<string, string>): number {
  const filled = PROSPERO_FIELDS.filter((f) => (fields[f.key] ?? '').trim().length > 0).length;
  return Math.round((filled / PROSPERO_FIELDS.length) * 100);
}

export function emptyFields(): Record<string, string> {
  return Object.fromEntries(PROSPERO_FIELDS.map((f) => [f.key, '']));
}

export function protocolToMarkdown(id: string, name: string, fields: Record<string, string>): string {
  const lines: string[] = [];
  lines.push(`# ${fields.title?.trim() || name}`);
  lines.push('');
  lines.push(`**Protocol ID:** ${id}  `);
  lines.push(`**Working name:** ${name}`);
  lines.push('');
  for (const g of PROSPERO_TEMPLATE) {
    lines.push(`## ${g.title}`);
    lines.push('');
    for (const f of g.fields) {
      lines.push(`### ${f.label}`);
      lines.push('');
      lines.push((fields[f.key] ?? '').trim() || '_Not yet completed._');
      lines.push('');
    }
  }
  return lines.join('\n');
}
