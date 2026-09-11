'From Cuis7.8 [latest update: #7959] on 10 September 2026 at 9:00:00 am'!
'Description:
  Meta-package that aggregates the Lisp smalltalk subsystem:
  LispReader (reader/parser), LispEvaluator (core evaluator),
  and LispWorkspace (REPL UI). Install this single package to
  get all three components together.'!
!provides: 'Lisp' 1 1!
!requires: 'LispReader' 1 1 nil!
!requires: 'LispEvaluator' 1 1 nil!
!requires: 'LispWorkspace' 1 1 nil!
SystemOrganization addCategory: #'Lisp'!
