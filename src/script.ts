import { createHash } from 'node:crypto';

/**
 * The single behaviour a transcript carries.
 *
 * SECURITY MODEL - read before changing anything here.
 *
 * A transcript reproduces attacker-controlled text, so the document forbids
 * scripts. This one is admitted by its SHA-256 hash rather than by relaxing
 * that: `script-src 'sha256-...'` runs exactly the bytes below and nothing
 * else. Content injected through a rendering mistake still cannot execute -
 * its hash would not match, an external `src` has no allowed host, and inline
 * handlers stay blocked because `unsafe-hashes` is not granted.
 *
 * Consequences that must be preserved:
 *   - The hash is derived from this string, so editing it cannot silently
 *     leave the policy pointing at the old bytes.
 *   - Nothing here reads a URL, writes markup, or evaluates a string. It moves
 *     the viewport and toggles a class.
 *   - Every element it acts on is one the renderer emitted, with an ID the
 *     renderer validated as a snowflake.
 *
 * Three behaviours, all of them class toggles: it marks <body> as scripted
 * (which switches spoilers from the hover fallback to click-to-reveal), it
 * scrolls reply jumps smoothly, and it reveals a spoiler that is clicked.
 *
 * Progressive enhancement: the reply row is a real link to the same anchor,
 * and without the `js` marker spoilers reveal on hover - so with scripts
 * blocked entirely, everything stays reachable.
 */
export const TRANSCRIPT_SCRIPT =
  `document.body.classList.add('js');` +
  `document.addEventListener('click',function(e){` +
  `var t=e.target instanceof Element?e.target:null;` +
  `if(!t)return;` +
  `var g=t.closest('[data-goto]');` +
  `if(g){var to=document.getElementById('m'+g.getAttribute('data-goto'));` +
  `if(!to)return;` +
  `e.preventDefault();` +
  `to.scrollIntoView({behavior:'smooth',block:'center'});` +
  `to.classList.add('flash');` +
  `setTimeout(function(){to.classList.remove('flash')},1200);` +
  `return}` +
  `var s=t.closest('.spoiler');` +
  `if(s)s.classList.add('revealed')` +
  `});`;

/** The `sha256-...` source expression that admits exactly the script above. */
export const TRANSCRIPT_SCRIPT_HASH = `sha256-${createHash('sha256')
  .update(TRANSCRIPT_SCRIPT, 'utf8')
  .digest('base64')}`;
