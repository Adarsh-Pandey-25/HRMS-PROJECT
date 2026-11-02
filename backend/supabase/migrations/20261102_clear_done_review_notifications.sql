-- One-time tidy-up, optional and safe to run more than once.
--
-- From 2 Nov 2026 a "please review" notification is marked read for everyone
-- as soon as its request is decided (notification.service.js
-- markReviewNotificationsRead). This does the same for the ones left over from
-- before: requests already approved, rejected, cancelled, resolved, verified
-- or deleted. A request still waiting keeps its notifications unread.
-- Only is_read changes; nothing is deleted.

-- Leave: still to do while pending; the first step's ones only until the
-- manager has approved (Manager → HR).
UPDATE notifications n
SET is_read = true
WHERE n.is_read = false
  AND n.type = 'LEAVE'
  AND n.title IN ('Leave request pending approval', 'Leave request submitted', 'Leave needs HR approval')
  AND n.meta->>'leave_id' IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM leaves l
    WHERE l.id::text = n.meta->>'leave_id'
      AND l.status = 'pending'
      AND (n.title = 'Leave needs HR approval' OR l.manager_approved_by IS NULL)
  );

-- Expenses: the same rule.
UPDATE notifications n
SET is_read = true
WHERE n.is_read = false
  AND n.type = 'REIMBURSEMENT'
  AND n.title IN ('Reimbursement pending approval', 'Reimbursement submitted', 'Reimbursement needs HR approval')
  AND n.meta->>'reimbursement_id' IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM reimbursements r
    WHERE r.id::text = n.meta->>'reimbursement_id'
      AND r.status = 'pending'
      AND (n.title = 'Reimbursement needs HR approval' OR r.manager_approved_by IS NULL)
  );

-- Work from home: still to do while any day of the request is pending.
UPDATE notifications n
SET is_read = true
WHERE n.is_read = false
  AND n.type = 'ATTENDANCE'
  AND n.title IN ('WFH request pending', 'WFH needs HR approval')
  AND n.meta->>'wfh_batch_id' IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM wfh_day_requests w
    WHERE w.batch_id::text = n.meta->>'wfh_batch_id'
      AND w.status = 'pending'
  );

-- Helpdesk tickets (attendance corrections too): done once resolved or closed.
-- The person who raised the ticket keeps their own updates.
UPDATE notifications n
SET is_read = true
WHERE n.is_read = false
  AND n.type = 'TICKET'
  AND n.title IN ('New helpdesk ticket', 'Ticket updated')
  AND n.meta->>'ticket_id' IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM helpdesk_tickets t
    WHERE t.id::text = n.meta->>'ticket_id'
      AND t.status IN ('resolved', 'closed')
      AND t.raised_by IS DISTINCT FROM n.user_id
  );

-- Documents: done once verified or deleted.
UPDATE notifications n
SET is_read = true
WHERE n.is_read = false
  AND n.type = 'DOCUMENT'
  AND n.title = 'Document pending verification'
  AND n.meta->>'document_id' IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM documents d
    WHERE d.id::text = n.meta->>'document_id'
      AND d.is_verified IS NOT TRUE
  );
