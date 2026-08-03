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
 * Progressive enhancement: the reply row is a real link to the same anchor, so
 * with scripts blocked entirely the jump still works - it just lands through
 * the address bar rather than scrolling to it.
 */
export const TRANSCRIPT_SCRIPT =
  `document.addEventListener('click',function(e){` +
  `var el=e.target instanceof Element?e.target.closest('[data-goto]'):null;` +
  `if(!el)return;` +
  `var to=document.getElementById('m'+el.getAttribute('data-goto'));` +
  `if(!to)return;` +
  `e.preventDefault();` +
  `to.scrollIntoView({behavior:'smooth',block:'center'});` +
  `to.classList.add('flash');` +
  `setTimeout(function(){to.classList.remove('flash')},1200)` +
  `});`;

/** The `sha256-...` source expression that admits exactly the script above. */
export const TRANSCRIPT_SCRIPT_HASH = `sha256-${createHash('sha256')
  .update(TRANSCRIPT_SCRIPT, 'utf8')
  .digest('base64')}`;
