def emptydone: test("no DONE|zero DONE|DONE[^.]{0,40}(empty|nothing|no criteria|zero|no items|no content|supplies no|contains no)|no definition of done|no done criteri";"i");
def big: .severity=="major" or .severity=="blocker";
def sig($drop): [ .envelope.objections[] | select(big) | select(($drop and .lens=="QA" and (.claim|emptydone)) | not) | .lens ] | unique;
def pass($s; $o; $cid; $new):
  if $new and $cid=="refutation-spec-006" then ($s == ["QA"])
  elif $o.closed_set then ($s == ($o.closed_set|sort))
  else (($o.lens_bounds.must_object - $s)|length==0) and (($s - $o.lens_bounds.must_object - ($o.lens_bounds.may_object//[]))|length==0) end;
group_by(.effort)[] | .[0].effort as $e |
 [ group_by(.case_id)[] | select(.[0].kind=="refutation-spec") |
   .[0].case_id as $cid | .[0].oracle as $o |
   { cid:$cid,
     now: (map(if .envelope then (if pass(sig(false);$o;$cid;false) then 1 else 0 end) else 0 end)|add/length),
     fixed: (map(if .envelope then (if pass(sig(true);$o;$cid;true) then 1 else 0 end) else 0 end)|add/length) } ] as $r |
 "\($e): now \(($r|map(.now)|add/length*1000|round)/1000) fixed \(($r|map(.fixed)|add/length*1000|round)/1000)  " + ($r|map(select((.fixed-.now)|fabs>0.02)|"\(.cid[16:]) \(.now*100|round)->\(.fixed*100|round)")|join(", "))
