import { Inngest } from 'inngest';

export const inngest = new Inngest({
  id: 'tally',
  eventKey: process.env.INNGEST_EVENT_KEY,
});
