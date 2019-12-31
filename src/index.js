// theres some things we may need to enforce differently when in and out of strict mode
// e.g. fn.arguments
'use strict'

const { isArray } = Array

class ObjectGraph {
  constructor ({ label, createHandler }) {
    this.rawToBridged = new WeakMap()
    this.handlerForRef = new WeakMap()
    this.label = label
    this.createHandler = createHandler || (() => Reflect)
  }

  getHandlerForRef (rawRef) {
    if (this.handlerForRef.has(rawRef)) {
      return this.handlerForRef.get(rawRef)
    }
    const handler = this.createHandler({
      setHandlerForRef: (ref, newHandler) => this.handlerForRef.set(ref, newHandler)
    })
    this.handlerForRef.set(rawRef, handler)
    return handler
  }
}

class Membrane {
  constructor () {
    this.primordials = [Object, Object.prototype]
    this.bridgedToRaw = new WeakMap()
    this.rawToOrigin = new WeakMap()
  }

  makeObjectGraph ({ label, createHandler }) {
    return new ObjectGraph({ label, createHandler })
  }

  // if rawObj is not part of inGraph, should we explode?
  bridge (inRef, inGraph, outGraph) {

    //
    // skip if should be passed directly (danger)
    //

    if (this.shouldSkipBridge(inRef)) {
      // console.log(`membrane.bridge should skip in:${inGraph.label} -> out:${outGraph.label}`)
      return inRef
    }

    //
    // unwrap ref and detect "origin" graph
    //

    let rawRef
    let originGraph

    if (this.bridgedToRaw.has(inRef)) {
      // we know this ref
      rawRef = this.bridgedToRaw.get(inRef)
      originGraph = this.rawToOrigin.get(rawRef)
    } else {
      // we've never seen this ref before - must be raw and from inGraph
      rawRef = inRef
      originGraph = inGraph
      // record origin
      this.rawToOrigin.set(inRef, inGraph)
    }

    //
    // wrap for ref for "out" graph
    //

    // if this ref originates in the "out" graph, deliver unwrapped
    if (originGraph === outGraph) {
      return rawRef
    }

    // if outGraph already has bridged wrapping for rawRef, use it
    if (outGraph.rawToBridged.has(rawRef)) {
      return outGraph.rawToBridged.get(rawRef)
    }

    // create new wrapping for rawRef
    const proxyTarget = getProxyTargetForValue(rawRef)
    const distortionHandler = originGraph.getHandlerForRef(rawRef)
    const membraneProxyHandler = createMembraneProxyHandler(distortionHandler, rawRef, originGraph, outGraph, this.bridge.bind(this))
    const proxyHandler = respectProxyInvariants(proxyTarget, membraneProxyHandler)
    const outRef = new Proxy(proxyTarget, proxyHandler)
    // cache both ways
    outGraph.rawToBridged.set(rawRef, outRef)
    this.bridgedToRaw.set(outRef, rawRef)

    // all done
    return outRef
  }

  shouldSkipBridge (value) {
    // Check for null and undefined
    if (value === null) {
      return true
    }
    if (value === undefined) {
      return true
    }

    // Check for non-objects
    const valueType = typeof value
    if (valueType !== 'object' && valueType !== 'function') {
      return true
    }

    // Early exit if the object is an Array.
    if (isArray(value) === true) {
      return false
    }

    return false
  }
}

// handler stack

// ProxyInvariantHandler calls next() <-- needs to have final say
//   MembraneHandler calls next() <-- needs to see distortion result
//     LocalWritesHandler sets behavior

// currently creating handler per-object
// perf: create only once?
//   better to create one each time with rawRef bound?
//   or find a way to map target to rawRef
function createMembraneProxyHandler (prevProxyHandler, rawRef, inGraph, outGraph, bridge) {
  const proxyHandler = {
    getPrototypeOf: createHandlerFn(prevProxyHandler.getPrototypeOf, rawRef, inGraph, outGraph, bridge),
    setPrototypeOf: createHandlerFn(prevProxyHandler.setPrototypeOf, rawRef, inGraph, outGraph, bridge),
    isExtensible: createHandlerFn(prevProxyHandler.isExtensible, rawRef, inGraph, outGraph, bridge),
    preventExtensions: createHandlerFn(prevProxyHandler.preventExtensions, rawRef, inGraph, outGraph, bridge),
    getOwnPropertyDescriptor: createHandlerFn(prevProxyHandler.getOwnPropertyDescriptor, rawRef, inGraph, outGraph, bridge),
    defineProperty: createHandlerFn(prevProxyHandler.defineProperty, rawRef, inGraph, outGraph, bridge),
    has: createHandlerFn(prevProxyHandler.has, rawRef, inGraph, outGraph, bridge),
    get: createHandlerFn(prevProxyHandler.get, rawRef, inGraph, outGraph, bridge),
    set: createHandlerFn(prevProxyHandler.set, rawRef, inGraph, outGraph, bridge),
    deleteProperty: createHandlerFn(prevProxyHandler.deleteProperty, rawRef, inGraph, outGraph, bridge),
    ownKeys: createHandlerFn(prevProxyHandler.ownKeys, rawRef, inGraph, outGraph, bridge),
    apply: createHandlerFn(prevProxyHandler.apply, rawRef, inGraph, outGraph, bridge),
    construct: createHandlerFn(prevProxyHandler.construct, rawRef, inGraph, outGraph, bridge)
  }
  return proxyHandler
}

// TODO ensure we're enforcing all proxy invariants
function respectProxyInvariants (proxyTarget, rawProxyHandler) {
  // the defaults arent needed for the membraneProxyHandler,
  // but might be for an imcomplete proxy handler
  const handlerWithDefaults = Object.assign({}, Reflect, rawProxyHandler)
  const respectfulProxyHandler = Object.assign({}, handlerWithDefaults)
  // add respect
  respectfulProxyHandler.getOwnPropertyDescriptor = (_, key) => {
    // ensure propDesc matches proxy target's non-configurable property
    const propDesc = handlerWithDefaults.getOwnPropertyDescriptor(_, key)
    if (propDesc && !propDesc.configurable) {
      const proxyTargetPropDesc = Reflect.getOwnPropertyDescriptor(proxyTarget, key)
      const proxyTargetPropIsConfigurable = (!proxyTargetPropDesc || proxyTargetPropDesc.configurable)
      // console.warn('@@ getOwnPropertyDescriptor - non configurable', String(key), !!proxyTargetPropIsConfigurable)
      // if proxy target is configurable (and real target is not) update the proxy target to ensure the invariant holds
      if (proxyTargetPropIsConfigurable) {
        Reflect.defineProperty(proxyTarget, key, propDesc)
      }
    }
    return propDesc
  }
  // return modified handler
  return respectfulProxyHandler
}

function createHandlerFn (reflectFn, rawRef, inGraph, outGraph, bridge) {
  return function (_, ...outArgs) {
    const inArgs = outArgs.map(arg => bridge(arg, outGraph, inGraph))
    let value, inErr
    try {
      value = reflectFn(rawRef, ...inArgs)
    } catch (err) {
      inErr = err
    }
    if (inErr !== undefined) {
      const outErr = bridge(inErr, inGraph, outGraph)
      throw outErr
    } else {
      return bridge(value, inGraph, outGraph)
    }
  }
}

// use replacement proxyTarget for flexible distortions less restrained by "Proxy invariant"
// e.g. hide otherwise non-configurable properties
function getProxyTargetForValue (value) {
  if (typeof value === 'function') {
    if (value.prototype) {
      return function () {}
    } else {
      return () => {}
    }
  } else {
    if (Array.isArray(value)) {
      return []
    } else {
      return {}
    }
  }
}

module.exports = { Membrane, ObjectGraph }
