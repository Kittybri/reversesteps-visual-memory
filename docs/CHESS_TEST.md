# First real test: the user's chess set

Selected by Abriana on October 26, 2026. Chess is an initial visual-memory test object, not a chess engine or a claim that the app knows chess rules. The task is restoring an arbitrary recorded arrangement, not inferring a standard opening position.

## Capture seven steps, with neutral labels

1. Set up a deliberately nonstandard arrangement on your board with a queen, knight, bishop, two opposite-color rooks and two same-color pawns. Use pieces from your own set. Keep the board orientation fixed and square labels visible if the board has them.
2. Photograph the arrangement **before lifting the queen**. Mark its visible region with a neutral label such as **piece A**. Use neutral notes such as **before removal 1**. Write the actual piece type, source region and square/location on a separate answer sheet that is never sent to the model.
3. Photograph the board before lifting the knight. Repeat for the rooks and bishop, one removal per recorded step. Mark each piece in its source photo with neutral labels B, C and so on.
4. Record and mark each of the two visually similar pawns before removal. Keep their actual locations on the separate answer sheet; do not invent visible differences. A neutral label identifies a source region, not a uniquely recognizable physical pawn.
5. Keep the pieces beside the board. Take close-up query photos in good light with a neutral background. Do not include the answer/location label in query photos.

The seven source photos show seven recorded states, with one marked target per step. They are not automatically inferred moves. The app's reverse timeline simply shows those real source photos in reverse order. Automatic square calibration is not implemented. A separate run with meaningful piece labels/notes may evaluate normal usability, but report its results separately: label-blind success provides stronger evidence of visual matching.

## Pre-label nine held-out queries

| Case | Expected behavior |
| --- | --- |
| Queen, new angle | Cite the recorded queen region if evidence supports it |
| Knight, new angle | Cite the recorded knight region |
| White rook, new angle | Cite only the corresponding recorded rook region |
| Black rook, new angle | Distinguish it from the white rook despite the shared shape |
| Bishop, unusual angle | Match or ask for a useful second view |
| Pawn A, away from board | If indistinguishable from pawn B, surface both candidates/uncertainty |
| Pawn B, away from board | Same uncertainty; do not claim individual identity from appearance |
| A piece absent from recorded states, such as an opposite-color king | No invented match; ask for missing evidence |
| An unrelated household object | No invented chess-piece match |

Photograph the **same physical piece** for any additional query view. Up to three views can be compared together. A second view cannot distinguish two truly identical pawns; ambiguity may remain. Do not count that as a failure or stage a false resolution.

Score the indistinguishable pawns as an ambiguity group: the response should expose both plausible recorded regions and avoid a single definitive origin. Report incomplete candidate recall separately if only one region is listed. Physical arrangement restoration can treat the two locations as equivalent only if the user independently confirms the pieces are interchangeable for this task. Never transfer that assumption to fasteners based on appearance alone.

## Honest demo opportunity

Show a distinctive piece → source photograph with its region highlighted → restore its recorded location. Then show the identical-pawn case and the explicit uncertainty. Invite a second person to reconstruct the recorded arrangement using the reverse evidence timeline. Record mistakes and time; don't claim an unseen-piece origin or game legality.

Before treating this as the final competition demo, compare it with one actual assembly/repair example. Chess validates the interaction and failure behavior; the broader impact story needs evidence from the physical task ReverseSteps aims to help with.
