/**
 * Flash requests from outside the rig: the check-in kiosk's ticket slot glows when YOU take a number (the queue does not show your number: you
 * are not drawn). A counter the rig drains once a frame; kept apart from the rig so the interaction module does not pull three.js in.
 */
let ticketRequests = 0

/** The ticket slot glows now. */
export function requestTicketFlash(): void {
  ticketRequests++
}

/** The number of requests since the last call (and forget them). */
export function takeTicketFlashRequests(): number {
  const n = ticketRequests
  ticketRequests = 0
  return n
}
