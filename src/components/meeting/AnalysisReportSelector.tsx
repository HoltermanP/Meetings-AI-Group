"use client";

import {
  ANALYSIS_REPORT_TYPES,
  DEFAULT_ANALYSIS_REPORT_TYPE,
  isComprehensiveReportType,
  type AnalysisReportDefinition,
  type AnalysisReportType,
} from "@/lib/analysis-report-types";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { FileBarChart, Sparkles } from "lucide-react";

type Props = {
  value: AnalysisReportType;
  onChange: (value: AnalysisReportType) => void;
  disabled?: boolean;
  className?: string;
};

function ReportOption({
  report,
  active,
  disabled,
  onSelect,
}: {
  report: AnalysisReportDefinition;
  active: boolean;
  disabled?: boolean;
  onSelect: () => void;
}) {
  const comprehensive = report.depth === "comprehensive";
  return (
    <label
      className={cn(
        "flex cursor-pointer gap-3 rounded-xl border-2 p-3 transition-colors",
        disabled && "cursor-not-allowed opacity-60",
        comprehensive && !active && "border-violet-200 bg-violet-50/30",
        active
          ? comprehensive
            ? "border-violet-600 bg-violet-50"
            : "border-indigo-500 bg-indigo-50/80"
          : !comprehensive && "border-gray-200 bg-white hover:border-indigo-200 hover:bg-indigo-50/30",
        comprehensive && !active && "hover:border-violet-300 hover:bg-violet-50/50",
      )}
    >
      <input
        type="radio"
        name="analysisReportType"
        value={report.id}
        checked={active}
        disabled={disabled}
        onChange={onSelect}
        className="mt-1 h-4 w-4 shrink-0 border-gray-300 text-indigo-600 focus:ring-indigo-500"
      />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm font-medium text-gray-900">{report.label}</span>
          {comprehensive && (
            <Badge
              variant="secondary"
              className="text-[10px] px-1.5 py-0 bg-violet-100 text-violet-800 border-violet-200"
            >
              Uitgebreid
            </Badge>
          )}
        </span>
        <span className="block text-xs text-gray-500 mt-0.5 leading-snug">{report.description}</span>
        <span
          className={cn(
            "block text-[11px] mt-1 font-medium",
            comprehensive ? "text-violet-700" : "text-indigo-600/90",
          )}
        >
          {report.audience}
        </span>
      </span>
    </label>
  );
}

export default function AnalysisReportSelector({
  value,
  onChange,
  disabled,
  className,
}: Props) {
  const selected = ANALYSIS_REPORT_TYPES.find((r) => r.id === value);
  const comprehensiveReports = ANALYSIS_REPORT_TYPES.filter((r) => r.depth === "comprehensive");
  const standardReports = ANALYSIS_REPORT_TYPES.filter((r) => r.depth === "standard");

  return (
    <div className={cn("space-y-4", className)}>
      <div className="flex items-start gap-2">
        <FileBarChart className="h-4 w-4 text-indigo-600 mt-0.5 shrink-0" />
        <div>
          <p className="text-sm font-semibold text-gray-800">Type analyserapport</p>
          <p className="text-xs text-gray-500 mt-0.5">
            Kies een beknopt rapport of een uitgebreid consultancy-rapport. Standaard: Executive
            Summary.
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2 px-1">
          <Sparkles className="h-3.5 w-3.5 text-violet-600" />
          <p className="text-xs font-semibold uppercase tracking-wide text-violet-800">
            Uitgebreid (consultancy)
          </p>
        </div>
        <div
          className="grid gap-2"
          role="radiogroup"
          aria-label="Uitgebreide rapporttypen"
        >
          {comprehensiveReports.map((report) => (
            <ReportOption
              key={report.id}
              report={report}
              active={value === report.id}
              disabled={disabled}
              onSelect={() => onChange(report.id)}
            />
          ))}
        </div>
        <p className="text-[11px] text-violet-700/90 px-1">
          Langere generatie (meerdere minuten). Geschikt voor bestuur en opdrachtgevers.
        </p>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 px-1">
          Standaard rapporten
        </p>
        <div
          className="grid gap-2 sm:grid-cols-2"
          role="radiogroup"
          aria-label="Standaard rapporttypen"
        >
          {standardReports.map((report) => (
            <ReportOption
              key={report.id}
              report={report}
              active={value === report.id}
              disabled={disabled}
              onSelect={() => onChange(report.id)}
            />
          ))}
        </div>
      </div>

      {selected && (
        <p
          className={cn(
            "text-xs rounded-lg border px-3 py-2",
            isComprehensiveReportType(selected.id)
              ? "text-violet-900 bg-violet-50 border-violet-100"
              : "text-gray-600 bg-gray-50 border-gray-100",
          )}
        >
          Geselecteerd: <strong>{selected.label}</strong> — {selected.description}
          {isComprehensiveReportType(selected.id) && (
            <span className="block mt-1 text-violet-700">
              Dit rapport wordt uitgebreid en diepgaand gegenereerd op consultancy-niveau.
            </span>
          )}
        </p>
      )}
    </div>
  );
}

export { DEFAULT_ANALYSIS_REPORT_TYPE };
