// Orchestrator: collects jobs from all configured ATS platforms and writes a merged JSON file.
import { writeFile } from "node:fs/promises";
import config from "./config.mjs";
import { collectGreenhouse } from "./platforms/greenhouse.mjs";
import { collectLever } from "./platforms/lever.mjs";
import { collectAshby } from "./platforms/ashby.mjs";
import { collectWorkable } from "./platforms/workable.mjs";
import { collectRecruitee } from "./platforms/recruitee.mjs";

const COLLECTORS = {
  greenhouse: collectGreenhouse,
  lever: collectLever,
  ashby: collectAshby,
  workable: collectWorkable,
  recruitee: collectRecruitee,
};

async function collectOne(platform, slug) {
  try {
    const jobs = await COLLECTORS[platform](slug);
    console.log(`  ${platform} ${slug}: ${jobs.length} jobs`);
    return jobs;
  } catch (err) {
    console.error(`  ${platform} ${slug}: FAILED — ${err.message}`);
    return [];
  }
}

async function main() {
  const outFile = process.argv[2] || "data/ats_jobs.json";
  const all = [];
  for (const [platform, slugs] of Object.entries(config)) {
    if (!slugs.length) continue;
    console.log(`\n[${platform}]`);
    for (const slug of slugs) {
      const jobs = await collectOne(platform, slug);
      all.push(...jobs);
    }
  }

  const unique = dedupe(all);
  await writeFile(outFile, JSON.stringify(unique, null, 2));
  console.log(`\nWrote ${unique.length} unique jobs to ${outFile}`);
}

function dedupe(jobs) {
  const seen = new Set();
  return jobs.filter((j) => {
    if (seen.has(j.job_posting_id)) return false;
    seen.add(j.job_posting_id);
    return true;
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
