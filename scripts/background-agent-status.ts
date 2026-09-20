import { getDatabase } from "../src/db/client";

const database = getDatabase();
const plans = database.prepare(`SELECT id,name,enabled,next_run_at,last_started_at,last_finished_at,last_status,
  consecutive_failures,last_error_code FROM agent_search_plans ORDER BY id`).all();
const jobs = database.prepare(`SELECT status,count(*) AS count FROM research_jobs GROUP BY status ORDER BY status`).all();
const discoveryJobs = database.prepare(`SELECT status,count(*) AS count FROM discovery_jobs GROUP BY status ORDER BY status`).all();
const documentJobs = database.prepare(`SELECT status,count(*) AS count FROM document_analysis_jobs GROUP BY status ORDER BY status`).all();
const recentTimeline = database.prepare(`SELECT event_type,subject_type,subject_id,project_id,summary,created_at
  FROM platform_timeline ORDER BY created_at DESC,id DESC LIMIT 20`).all();
const recentWorkflowRuns = database.prepare(`SELECT id,workflow_id,workflow_version,trigger_type,trigger_ref,status,error_code,started_at,finished_at
  FROM workflow_runs ORDER BY started_at DESC,id DESC LIMIT 20`).all();
process.stdout.write(`${JSON.stringify({ plans, discoveryJobs, jobs, documentJobs, recentWorkflowRuns, recentTimeline }, null, 2)}\n`);
