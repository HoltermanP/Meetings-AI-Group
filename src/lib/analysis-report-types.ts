/**
 * Consultancy-rapporttypen voor AI-analyse van vergadertranscripten.
 */

export const DEFAULT_ANALYSIS_REPORT_TYPE = "executive_summary" as const;

export type AnalysisReportType =
  | "executive_summary"
  | "swot"
  | "root_cause"
  | "action_items"
  | "risk_assessment"
  | "stakeholder"
  | "process_improvement"
  | "formal_minutes"
  | "comprehensive_analysis"
  | "comprehensive_advice";

export type ReportDepth = "standard" | "comprehensive";

export type AnalysisReportDefinition = {
  id: AnalysisReportType;
  label: string;
  description: string;
  audience: string;
  depth: ReportDepth;
  /** Markdown-structuur voor het AI-verslag */
  structure: string;
  /** Actiepunten ook als JSON-array extraheren naar de database */
  extractActionItems: boolean;
};

export const ANALYSIS_REPORT_TYPES: AnalysisReportDefinition[] = [
  {
    id: "executive_summary",
    label: "Executive Summary",
    description: "1–2 pagina's met kernpunten, besluiten, acties en risico's.",
    audience: "C-level / management",
    depth: "standard",
    extractActionItems: true,
    structure: `## Executive summary
3–6 zinnen: doel van het overleg, belangrijkste uitkomst en urgentie.

## Kernpunten
Bulletlijst (max. 8) van de belangrijkste inzichten en besluiten.

## Acties (samenvatting)
Tabel of bullets: actie | eigenaar (indien genoemd) | prioriteit/toelichting.

## Risico's & aandachtspunten
Bulletlijst van risico's, blokkades of open punten; kort mitigatie-advies waar mogelijk.

## Aanbeveling management
1 alinea: wat nu besloten of opgepakt moet worden.`,
  },
  {
    id: "swot",
    label: "SWOT-analyse",
    description: "Strengths, Weaknesses, Opportunities, Threats uit het gesprek.",
    audience: "Strategische planning",
    depth: "standard",
    extractActionItems: false,
    structure: `## Context
1–2 zinnen over onderwerp en scope van de analyse.

## Strengths (sterktes)
Bulletlijst — interne positieve factoren uit het transcript.

## Weaknesses (zwaktes)
Bulletlijst — interne beperkingen of problemen.

## Opportunities (kansen)
Bulletlijst — externe of toekomstige kansen.

## Threats (bedreigingen)
Bulletlijst — externe risico's of dreigingen.

## Strategische implicaties
Korte synthese: wat betekent deze SWOT voor vervolgstappen?`,
  },
  {
    id: "root_cause",
    label: "Root Cause Analysis (5 Why's)",
    description: "Probleem diepgaand uitwerken met oorzaak-gevolg en 5 Why's.",
    audience: "Operationele issues",
    depth: "standard",
    extractActionItems: true,
    structure: `## Probleemstelling
Helder geformuleerd hoofdprobleem uit het gesprek.

## Symptomen & impact
Wat is er zichtbaar misgegaan; impact op proces, klant of team.

## Oorzaak-gevolg (kort)
Beschrijf de keten van gebeurtenissen; gebruik waar nuttig een simpele opsomming.

## 5 Why's
Genummerde lijst (Why 1 t/m 5) tot je bij een plausibele hoofdoorzaak komt. Als het transcript onvoldoende detail heeft, benoem aannames expliciet.

## Hoofdoorzaak
1–2 zinnen: de meest waarschijnlijke root cause.

## Corrigerende maatregelen
Concrete aanbevelingen om herhaling te voorkomen.`,
  },
  {
    id: "action_items",
    label: "Action Items & Owners",
    description: "Gestructureerde takenlijst met eigenaar, deadline en status.",
    audience: "Vervolgmeetings / opvolging",
    depth: "standard",
    extractActionItems: true,
    structure: `## Samenvatting opvolging
2–3 zinnen over wat er opgevolgd moet worden.

## Actiepunten
Markdown-tabel met kolommen: **#** | **Actie** | **Eigenaar** | **Deadline** | **Status** | **Opmerking**
- Status: Open / In uitvoering / Afgerond / Onbekend (kies op basis van transcript).
- Alleen acties die expliciet of impliciet uit het gesprek volgen; geen verzonnen deadlines.

## Afhankelijkheden & blokkades
Bulletlijst indien relevant.

## Volgende check-in
Wanneer of hoe opvolging besproken wordt (indien genoemd).`,
  },
  {
    id: "risk_assessment",
    label: "Risk Assessment",
    description: "Risico's met impact/likelihood en mitigatie.",
    audience: "Risk & compliance",
    depth: "standard",
    extractActionItems: true,
    structure: `## Scope
Waarop deze risicoanalyse betrekking heeft.

## Geïdentificeerde risico's
Per risico een subkop (### Risico 1: …) met:
- **Beschrijving**
- **Impact** (Laag / Midden / Hoog) + toelichting
- **Likelihood** (Laag / Midden / Hoog) + toelichting
- **Mitigatie** — voorgestelde maatregelen

## Risicomatrix (samenvatting)
Markdown-tabel: Risico | Impact | Likelihood | Prioriteit (P1–P3)

## Restrisico & monitoring
Wat blijft over; hoe monitoren.`,
  },
  {
    id: "stakeholder",
    label: "Stakeholder Analysis",
    description: "Betrokken partijen, belangen en invloed.",
    audience: "Change management",
    depth: "standard",
    extractActionItems: false,
    structure: `## Overzicht
Kort doel van de stakeholder-analyse voor dit overleg.

## Stakeholders
Per stakeholder (subkop ### Naam/rol):
- **Belang** — wat willen ze bereiken?
- **Invloed / macht** (Laag / Midden / Hoog)
- **Houding** — supporter / neutraal / kritisch (indien af te leiden)
- **Impact op project/verandering**

## Krachtenveld
Korte analyse van spanningen of coalities.

## Aanbevolen communicatie & engagement
Concrete adviezen per belangrijke stakeholder.`,
  },
  {
    id: "process_improvement",
    label: "Process Improvement",
    description: "Huidig proces, bottlenecks en verbeteradvies.",
    audience: "Operations / continuous improvement",
    depth: "standard",
    extractActionItems: true,
    structure: `## Huidig proces (as-is)
Beschrijf het besproken proces in stappen (genummerd).

## Bottlenecks & pijnpunten
Bulletlijst met oorzaak en effect.

## Data & signalen
Welke feiten of voorbeelden uit het transcript ondersteunen de analyse.

## Verbeterkansen (to-be)
Concrete verbeteringen, geprioriteerd (quick wins vs. structureel).

## Implementatie-aanbevelingen
Wie doet wat; geschatte volgorde of fasen.`,
  },
  {
    id: "formal_minutes",
    label: "Notulen (formeel)",
    description: "Formele notulen met agenda, discussie, besluiten en acties.",
    audience: "Archief / compliance",
    depth: "standard",
    extractActionItems: true,
    structure: `## Vergadergegevens
- **Onderwerp:** (uit transcript)
- **Datum/tijd:** (indien genoemd, anders "niet vermeld")
- **Aanwezig:** lijst van genoemde deelnemers

## Agenda
Genummerde agendapunten zoals besproken.

## Verslag per agendapunt
Per punt (### 1. …):
- **Discussie** — kern van het gesprek
- **Besluit** — expliciete besluiten of "geen besluit"
- **Actie** — taken met eigenaar indien toegekend

## Besluitenlijst (samenvatting)
Bulletlijst van alle besluiten.

## Actiepuntenlijst (samenvatting)
Bulletlijst actie | eigenaar.`,
  },
  {
    id: "comprehensive_analysis",
    label: "Uitgebreid analyserapport",
    description:
      "Diepgaand consultancy-rapport (8–15+ pagina's equivalent): context, bevindingen, onderbouwing en conclusies.",
    audience: "Bestuur / programmamanagement / due diligence",
    depth: "comprehensive",
    extractActionItems: true,
    structure: `## Management summary
Uitgebreide samenvatting (½–1 pagina equivalent): aanleiding, scope, belangrijkste conclusies en urgentie. Geen nieuwe feiten t.o.v. latere hoofdstukken.

## 1. Aanleiding en opdracht
### 1.1 Context en achtergrond
Waarom dit overleg plaatsvond; organisatorische en business context.
### 1.2 Doel en scope van deze analyse
Wat wel/niet is geanalyseerd; afbakening expliciet benoemen.
### 1.3 Methodologie en bronnen
Transcript als primaire bron; aanvullende notities; beperkingen van de analyse.

## 2. Situatieschets (huidige stand)
### 2.1 Beschreven situatie
Feitelijke beschrijving van de huidige situatie zoals uit het gesprek blijkt.
### 2.2 Betrokken partijen en belangen
Wie is betrokken; welke belangen en spanningen spelen (indien af te leiden).
### 2.3 Relevante feiten en signalen
Gestructureerde opsomming van harde feiten vs. interpretaties; label onzekerheden.

## 3. Analyse per thema
Werk minimaal 3–5 thema's uit die in het transcript aan bod komen. Per thema een subkop ### Thema X: [naam] met:
- **Observatie** — wat is er gezegd/gedocumenteerd
- **Analyse** — wat betekent dit (oorzaken, patronen, samenhang)
- **Implicaties** — gevolgen voor organisatie, proces, klant of resultaat
- **Evidenceniveau** — Hoog / Midden / Laag (hoe sterk onderbouwd door het transcript)

## 4. Kruisverbanden en spanningsvelden
Synthese over thema's heen: tegenstrijdigheden, afhankelijkheden, blinde vlekken.

## 5. Gap-analyse
### 5.1 Huidige situatie vs. gewenste situatie
Waar zit de grootste kloof (indien uit gesprek af te leiden).
### 5.2 Ontbrekende informatie
Wat ontbreekt in het transcript om zeker te beslissen; formuleer gerichte vragen.

## 6. Risico's en onzekerheden (analytisch)
Per risico: beschrijving, impact, waarschijnlijkheid, onderbouwing uit gesprek, onzekerheidsfactor.

## 7. Conclusies
Genummerde kernconclusies (5–10), elk met 2–4 zinnen onderbouwing. Alleen conclusies die uit de analyse volgen.

## 8. Aanbevelingen voor vervolgonderzoek
Wat moet nader worden uitgezocht voordat grote besluiten worden genomen.

## Bijlage: Citaten en parafen uit het gesprek
Korte, relevante quotes (max. 8) die kritieke punten ondersteunen.`,
  },
  {
    id: "comprehensive_advice",
    label: "Uitgebreid adviesrapport",
    description:
      "Consultancy adviesrapport met opties, aanbeveling, implementatiepad en governance (8–15+ pagina's equivalent).",
    audience: "Bestuur / directie / opdrachtgever",
    depth: "comprehensive",
    extractActionItems: true,
    structure: `## Management advies (samenvatting)
Heldere aanbeveling in 1 alinea + top-3 acties + verwachte impact. Geschikt voor bestuurders die alleen dit hoofdstuk lezen.

## 1. Opdracht en adviesvraag
Formuleer de impliciete of expliciete adviesvraag uit het overleg.

## 2. Analyse-kern (beknopt)
2–3 pagina's equivalent: alleen de analyse die nodig is om het advies te dragen (geen herhaling van volledig analyserapport tenzij nodig).

## 3. Adviesopties
Presenteer minimaal 2–3 realistische opties (ook "niets doen" of "uitstellen" indien relevant). Per optie ### Optie A/B/C: [naam]:
- **Omschrijving**
- **Voordelen**
- **Nadelen en risico's**
- **Benodigde middelen** (tijd, mensen, budget — kwalitatief indien niet genoemd)
- **Geschiktheid** — voor wie/wanneer

## 4. Gewenste aanbeveling
### 4.1 Geadviseerde koers
Welke optie (of combinatie) wordt geadviseerd en waarom.
### 4.2 Onderbouwing
Argumentatie gekoppeld aan bevindingen uit het gesprek; benoem trade-offs expliciet.
### 4.3 Randvoorwaarden voor succes
Wat moet waar zijn opdat het advies werkt ( sponsorship, data, capaciteit).

## 5. Implementatie- en veranderplan
### 5.1 Roadmap (fasen)
Fase 1–3 met doelen, deliverables en indicatieve timing (weken/maanden — alleen als gesprek dat toelaat, anders "nader te bepalen").
### 5.2 Quick wins (0–4 weken)
Concrete eerste stappen.
### 5.3 Structurele maatregelen
Langere termijn wijzigingen.

## 6. Governance en opvolging
RACI-achtige tabel (Rol | Verantwoordelijkheid | Naam indien genoemd), overlegstructuur, KPI's of succescriteria.

## 7. Risico's op implementatie en mitigatie
Per risico: mitigatie, eigenaar, trigger voor escalatie.

## 8. Communicatie- en stakeholderadvies
Hoe betrokkenen informeren en meenemen; prioriteit stakeholders.

## 9. Besluitpunten voor opdrachtgever
Genummerde besluiten die nu genomen moeten worden (met opties waar relevant).

## 10. Actieplan (samenvattend)
Markdown-tabel: Prioriteit | Actie | Eigenaar | Deadline/indicatie | Afhankelijkheden`,
  },
];

const REPORT_BY_ID = new Map(
  ANALYSIS_REPORT_TYPES.map((r) => [r.id, r]),
);

export function isAnalysisReportType(value: unknown): value is AnalysisReportType {
  return typeof value === "string" && REPORT_BY_ID.has(value as AnalysisReportType);
}

export function getAnalysisReportDefinition(
  type: AnalysisReportType,
): AnalysisReportDefinition {
  return REPORT_BY_ID.get(type) ?? REPORT_BY_ID.get(DEFAULT_ANALYSIS_REPORT_TYPE)!;
}

const COMPREHENSIVE_WRITING_RULES = `
SCHRIJFSTIJL (uitgebreid consultancy-niveau):
- Schrijf alsof je een senior consultant bent bij een top-tier firma (McKinsey/BCG/Bain-niveau): zakelijk, helder, onderbouwd.
- Lengte: schrijf UITGEBREID — streef naar een volledig rapport (minimaal 3.000–5.000 woorden equivalent), tenzij het transcript zeer kort is; werk dan diepgang uit binnen de beschikbare inhoud.
- Gebruik ###-subkoppen waar de structuur dat aangeeft; vul elke subsectie met meerdere alinea's of bullets.
- Onderscheid feiten (uit transcript) van interpretatie en aanbevelingen; label aannames expliciet als "Aanname:".
- Geen opvulling met generieke managementpraat; elke alinea moet terug te voeren zijn op het gesprek of logisch afgeleid zijn.
- Waar het transcript dun is: benoem gaps en stel verdiepende vragen — vul niet met verzonnen cijfers of namen.`;

export function isComprehensiveReportType(type: AnalysisReportType): boolean {
  return getAnalysisReportDefinition(type).depth === "comprehensive";
}

/** Hogere outputlimiet voor uitgebreide rapporten (streaming). */
export function getAnalysisReportMaxTokens(type: AnalysisReportType): number {
  return isComprehensiveReportType(type) ? 16_384 : 4096;
}

export function getAnalysisReportStructure(type: AnalysisReportType): string {
  const def = getAnalysisReportDefinition(type);
  const depthRules =
    def.depth === "comprehensive"
      ? COMPREHENSIVE_WRITING_RULES
      : "Houd het rapport beknopt en to-the-point per sectie.";

  return `RAPPORTTYPE: ${def.label}
Doelgroep: ${def.audience}
Niveau: ${def.depth === "comprehensive" ? "Uitgebreid consultancy-rapport" : "Standaard"}

${depthRules}

Gebruik exact deze Markdown-structuur (##- en ###-koppen in deze volgorde). Vul elke sectie uit op basis van het transcript; alleen echt lege secties: één zin "(Niet besproken.)".

${def.structure}

Geen andere hoofdstukken toevoegen. Geen aparte titelregel boven de eerste ##-kop.`;
}
