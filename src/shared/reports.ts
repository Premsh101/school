// Reports shared by the API and the web app. Each module lists its own reports; the
// Reports page shows every report the signed-in person may open, grouped by module.

export type ReportColumnKind = 'text' | 'money' | 'number' | 'date';
export interface ReportColumn {
  key: string;
  label: string;
  kind: ReportColumnKind;
}
export interface ReportResult {
  title: string;
  columns: ReportColumn[];
  rows: Record<string, string | number | null>[];
  /** True when there were more rows than the limit; narrow the filters to see the rest. */
  truncated: boolean;
}

/** Filters a report can offer. The Reports page shows only the ones a report lists. */
export type ReportFilter =
  'dates' | 'branch' | 'class' | 'section' | 'mode' | 'basis' | 'min' | 'status';

export interface ReportDef {
  id: string;
  name: string;
  description: string;
  filters: readonly ReportFilter[];
}

/** Core reports about students, served at /api/reports/:id. */
export const CORE_REPORTS = [
  {
    id: 'students',
    name: 'Student list',
    description: 'Every student with class, roll number, parents and phone numbers.',
    filters: ['branch', 'class', 'section', 'status'],
  },
  {
    id: 'strength',
    name: 'Class strength',
    description: 'Students in each class and section: boys, girls, new and old, left.',
    filters: ['branch'],
  },
  {
    id: 'left',
    name: 'Students who left',
    description: 'Students marked as left this session, with the date and phone numbers.',
    filters: ['branch', 'class'],
  },
] as const satisfies readonly ReportDef[];
export type CoreReportId = (typeof CORE_REPORTS)[number]['id'];
