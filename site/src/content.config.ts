/**
 * Content collections — the data contract for the whole site AND for the
 * Decap CMS admin (its config mirrors these schemas 1:1).
 * Structured data only; HTML pages are generated, never hand-edited.
 */
import { defineCollection, z } from "astro:content";
import { glob, file } from "astro/loaders";
import { parse as parseYaml } from "yaml";

const keyed = (key: string) => (text: string) => parseYaml(text)[key] ?? [];

/** Current members. Source of truth: src/data/people.yml (migrated in W2). */
const people = defineCollection({
  loader: file("src/data/people.yml", { parser: keyed("people") }),
  schema: z.object({
    id: z.string().optional(), // slug — auto-derived from name at build when absent
    name: z.string(),
    role: z.string(), // free text — e.g. "PhD Student", "MRes Y2 + PhD"
    group: z.string().optional(), // free-text grouping hint (founder: never hard-code)
    photo: z.string().optional(), // repo path; optional → default avatar, never a broken img
    keywords: z.array(z.string()).max(6).default([]),
    links: z
      .object({
        linkedin: z.string().url().optional(),
        scholar: z.string().url().optional(),
        orcid: z.string().url().optional(),
        website: z.string().url().optional(),
      })
      .default({}),
    cohort: z.number().int().min(2015).max(2100).optional(), // start year
  }),
});

/** Alumni. Source of truth: src/data/alumni.yml (migrated in W2). */
const alumni = defineCollection({
  loader: file("src/data/alumni.yml", { parser: keyed("alumni") }),
  schema: z.object({
    id: z.string().optional(), // auto-derived from name at build when absent
    name: z.string(),
    degree: z.string(), // "PhD", "MRes", "Postdoc", …
    graduated: z.number().int(),
    thesis: z.string().optional(),
    supervisors: z.array(z.string()).default([]),
    destination: z.string().optional(), // "Google", "Assistant Professor, X" — only if verified
    award: z.string().optional(),
    link: z.string().url().optional(),
  }),
});

/** Research themes/projects — only pages with real substance earn existence. */
const research = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/research" }),
  schema: z.object({
    title: z.string(),
    summary: z.string().max(300),
    status: z.enum(["active", "completed"]).default("active"),
    people: z.array(z.string()).default([]), // people ids
    papers: z.array(z.string()).default([]), // BibTeX keys
    code: z.string().url().optional(),
    demo: z.string().url().optional(),
    partners: z.array(z.string()).default([]),
    order: z.number().default(99),
  }),
});

/** News/blog — multi-author, admin-assigned contributors (governance design).
 *  Subfolders map to ownership sections: news/lab/, news/bds/, news/aipa/, … */
const news = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/news" }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    teaser: z.string().max(280),
    kind: z
      .enum(["lab-news", "tech-news", "linkedin-mirror", "event", "award", "publication", "keynote"])
      .default("lab-news"),
    program: z.enum(["dsrl", "bds", "aipa", "aiple", "biofm"]).default("dsrl"),
    author: z.string().optional(), // people.yml id where possible
    contributors: z.array(z.string()).default([]),
    tags: z.array(z.string()).max(5).default([]),
    cover: z
      .object({
        image: z.string(),
        alt: z.string(), // specific, factual alt text — required with any image
      })
      .optional(),
    source: z
      .object({
        label: z.string(), // e.g. "LinkedIn post"
        url: z.string().url(),
        canonical: z.boolean().default(false),
      })
      .optional(), // manual repost attribution — never scraped content
  }),
});

/** Workshops & events — an EVENT model, not just archive links. */
const workshops = defineCollection({
  loader: glob({ pattern: "**/*.yml", base: "./src/content/workshops" }),
  schema: z.object({
    series: z.string(), // "AIPA", "AIPLE", "BioFM", "BDS Hackathon"
    edition: z.string(), // "AI-PA 2025"
    title: z.string(),
    year: z.number().int(),
    status: z.enum(["upcoming", "past"]),
    dates: z.string(), // human-readable; ICS uses startDate
    startDate: z.coerce.date().optional(),
    endDate: z.coerce.date().optional(),
    timezone: z.string().default("Australia/Sydney"),
    venue: z.string().optional(),
    colocated: z.string().optional(), // "ICSOC 2025, Shenzhen"
    chairs: z.array(z.string()).default([]),
    sponsors: z.array(z.string()).default([]),
    cfpDeadline: z.coerce.date().optional(),
    url: z.string(), // archive page (existing URL, kept alive) or external site
    proceedings: z.string().url().optional(),
  }),
});

/** Standalone pages — FOUNDER-ONLY (governance: content-owners.yml default-deny;
 *  deliberately not listed as an editable section). Each markdown file becomes
 *  /<filename>/ via src/pages/[...slug].astro, which enforces slug safety.
 *  No nav field on purpose: navigation is founder-managed in Base.astro. */
const pages = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/pages" }),
  schema: z.object({
    title: z.string(),
    description: z.string().max(200),
  }),
});

export const collections = { people, alumni, research, news, workshops, pages };
