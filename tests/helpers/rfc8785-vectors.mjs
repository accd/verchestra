// Official RFC 8785 (JSON Canonicalization Scheme) test vectors.
// Source: https://github.com/cyberphone/json-canonicalization/tree/master/testdata
// (input/*.json, output/*.json) — the reference vectors named in CJ-03.
export const RFC8785_VECTORS = [
  {
    name: "arrays",
    input: JSON.parse('[56,{"1":[],"10":null,"d":true}]'),
    output: '[56,{"1":[],"10":null,"d":true}]'
  },
  {
    name: "french",
    input: JSON.parse(
      '{"peach":"This sorting order","p\u00e9ch\u00e9":"is wrong according to French","p\u00eache":"but canonicalization MUST","sin":"ignore locale"}'
    ),
    output:
      '{"peach":"This sorting order","p\u00e9ch\u00e9":"is wrong according to French","p\u00eache":"but canonicalization MUST","sin":"ignore locale"}'
  },
  {
    name: "structures",
    input: JSON.parse(
      '{"1":{"f":{"f":"hi","F":5},"\\n":56},"10":{},"111":[{"e":"yes","E":"no"}],"":"empty","a":{},"A":{}}'
    ),
    output: '{"":"empty","1":{"\\n":56,"f":{"F":5,"f":"hi"}},"10":{},"111":[{"E":"no","e":"yes"}],"A":{},"a":{}}'
  },
  {
    name: "values",
    input: JSON.parse(
      '{"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"\u20ac$\\u000f\\nA\'B\\"\\\\\\\\\\"/","literals":[null,true,false]}'
    ),
    output:
      '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"\u20ac$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}'
  },
  {
    name: "weird",
    input: JSON.parse(
      '{"1":"One","\u20ac":"Euro Sign","\\r":"Carriage Return","\\n":"Newline","\u0080":"Control\u007f","\ud83d\ude02":"Smiley","\u00f6":"Latin Small Letter O With Diaeresis","\ufb33":"Hebrew Letter Dalet With Dagesh","</script>":"Browser Challenge"}'
    ),
    output:
      '{"\\n":"Newline","\\r":"Carriage Return","1":"One","</script>":"Browser Challenge","\u0080":"Control\u007f","\u00f6":"Latin Small Letter O With Diaeresis","\u20ac":"Euro Sign","\ud83d\ude02":"Smiley","\ufb33":"Hebrew Letter Dalet With Dagesh"}'
  }
];
