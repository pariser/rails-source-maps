var Example = (function() {
  "use strict";

  var example = {};

  example.VARIABLE = [
    'foo',
    'bar',
    'baz'
  ];

  example.fn = function(arg, cb) {
    if (typeof cb === 'undefined') {
      cb = arg;
      arg = null;
    }

    if (!arg) {
      arg = '[defaultArgument]';
    }

    console.log('Got argument: ' + arg);

    if (cb) {
      cb();
    }
  };

  return example;

}());

console.log('Example started.');
Example.fn(Example.VARIABLE, function() {
  "use strict";
  console.log('Example finished.');
});
