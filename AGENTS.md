# Agent Instructions for `jskit-ai`

## Golden HARD RULE when adding or changing anything: 
  * No tricks. Code needs to be understood by a junior programmer
  * Best practices. Tidy. Minimal
  * NO SLOP. NO REPETITIONS. Do not introduce small general methods without CAREFULLY checking whether that method already 
  * IGNORE completely any code in LEGACY/

## After finishing a set of modificatons
After making a set of modifications, do a last check, and if one of them fails, go back to the code and fix it. The
requirements for passing are:
  1) It has no slop/repeated code
  2) It doesn't repeat the same shit in different files
  3) It doesn't reinvent something that was already in the kernel
  4) It doesn't mitigate the problem in different layeas at the same time
  5) It IS the most elegant solution available, which fits with the system
 
