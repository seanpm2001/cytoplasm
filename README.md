# 🦠 cytoplasm 🔬

a javascript [membrane](https://tvcutsem.github.io/membranes) implementation.
This implementation is intended to provide *secure* isolation between any number of membrane spaces.
This implementation intends to support all types of objects including functions, classes, etc.
By default, all membrane spaces have a "transparent distortion", meaning all operations are forwarded to the original graph.
In order for this membrane to be useful you will need to provide a distortion implementation.

**status: has not been audited, here be dragons, etc**

### features

##### intent of secure isolation
(note: this module has not been audited for security)
membrane-wrapped objects should always invoke the relevant distortion

##### multiple membrane spaces
the membrane will wrap/unwrap objects when passed across membrane space boundaries.
If an object is created in space A, passed to space B, then to space C, and returned to space A, it will be given to space A unwrapped as a raw object.

##### support for any object type
the membrane is intended to support any type of javascript object (TypedArray instances, objects with prototype chains, Proxy instances). empty values (`null`, `undefined`) and non-object values (number, string) are passed through un-wrapped. Primordials (`Object`, `Object.prototype`, etc) are also passed through unwrapped.

##### set distortions per-object
distortions are hooks into interactions with objects across MembraneSpace boundaries. The distortions are set at the object's origin MebraneSpace. The distortions are applied when the object is referenced in another MembraneSpace. The distortions are not applied in the origin MembraneSpace, as the object is a raw (unwrapped) reference there. The distortions will not be applied in MembraneSpaces that specify the option `{ dangerouslyAlwaysUnwrap: true }`.

distortions can be set in two ways:
- via the default handler for the MembraneSpace via the `createHandler` option.
- overridden for a specific reference via the `membraneSpace.handlerForRef` WeakMap.

Using these two approaches allows you to have a different distortion for a subset of the MembraneSpace's objects.


### example

```js
const { Membrane } = require('cytoplasm')
const createReadOnlyDistortion = require('cytoplasm/src/distortions/readOnly')

const membrane = new Membrane()
const graphA = membrane.makeMembraneSpace({ label: 'a', createHandler: createReadOnlyDistortion })
const graphB = membrane.makeMembraneSpace({ label: 'b' })

const objA = {
  value: 123,
  set: function (newVal) { this.value = newVal },
}
const objAWrappedForB = membrane.bridge(objA, graphA, graphB)

// original object is still mutable
objA.value = 456
// the specified readOnlyDistortion allows the wrapped object to internally mutate itself
// so the value is updated
objAWrappedForB.set(13)
// this assignment fails and throws an error under strict mode
objAWrappedForB.value = 42
```

### class instance origin space

The origin space of an instance of a class with cross-space protoype chain is somewhat complicated, due to differences in class constructors vs function constructors, as well as the Builtins.
The instance ends up being claimed by the first constructor it is exposed to. Since class constructors cant access `this` until they've called `super(...)`, ownership is pushed further down the chain. The function constructors can access `this` immediately and will claim the instance. Builtins skip membrane wrapping and so do not trigger a claim on `this`.

examples:

```
inst
class A
class B
class C <-- origin space
Object
```

```
inst
class A
function B <-- origin space
function C
Object
```


### comparison to other implementations

repo  | n-sides  | audit
---|---|---
cytoplasm  | ✓ | x
[es-membrane][es-membrane]  | ✓ | x
[@caridy/sjs][@caridy/sjs]  | x | x
[observable-membrane][observable-membrane]  | x | x
[fast-membrane][fast-membrane]  | x | x
[membrane-traits][membrane-traits]  | x | x


[es-membrane]: https://github.com/ajvincent/es-membrane "es-membrane"
[@caridy/sjs]: https://github.com/caridy/secure-javascript-environment/ "secure-javascript-environment"
[observable-membrane]: https://github.com/salesforce/observable-membrane "observable-membrane"
[fast-membrane]: https://github.com/pmdartus/fast-membrane "fast-membrane"
[membrane-traits]: https://github.com/Gozala/membrane-traits "membrane-traits"
