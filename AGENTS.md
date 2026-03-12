# Agent Instructions for `jskit-ai`

## Golden HARD RULE when adding or changing anything: 
  * NO BACK COMPATIBILITY, SHIMS, NOTHING. This is version 0, we can't start with tech debt and layers
  * No tricks. Code needs to be understood by a junior programmer
  * Best practices. Tidy. Minimal
  * NO SLOP. NO REPETITIONS. If something is new and useful to other elements, it goes into Kernel or into a module
## After finishing a set of modificatons
After making a set of modifications, do a last check, and if one of them fails, go back to the code and fix it. The
requirements for passing are:
  1) It has no slop
  2) It doesn't repeat the same shit in different files
  3) It doesn't reinvent something that was already in the kernerl
  4) It doesn't mitigate the problem in different layeas at the same time
  5) It IS the most elegant solution available, which fits with the system
 
