-- Personal / family tasks (e.g. kids' checklists) that should be hidden from
-- the office staff view. Only the assignee, the assigner, and superadmin can
-- see private tasks. Default false so existing tasks stay visible as before.

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS private boolean NOT NULL DEFAULT false;
