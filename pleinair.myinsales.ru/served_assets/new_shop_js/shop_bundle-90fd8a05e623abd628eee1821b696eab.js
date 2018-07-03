/**
 * @license almond 0.3.1 Copyright (c) 2011-2014, The Dojo Foundation All Rights Reserved.
 * Available via the MIT or new BSD license.
 * see: http://github.com/jrburke/almond for details
 */
//Going sloppy to avoid 'use strict' string cost, but strict practices should
//be followed.
/*jslint sloppy: true */
/*global setTimeout: false */


var requirejs, require, define;
(function (undef) {
    var main, req, makeMap, handlers,
        defined = {},
        waiting = {},
        config = {},
        defining = {},
        hasOwn = Object.prototype.hasOwnProperty,
        aps = [].slice,
        jsSuffixRegExp = /\.js$/;

    function hasProp(obj, prop) {
        return hasOwn.call(obj, prop);
    }

    /**
     * Given a relative module name, like ./something, normalize it to
     * a real name that can be mapped to a path.
     * @param {String} name the relative name
     * @param {String} baseName a real name that the name arg is relative
     * to.
     * @returns {String} normalized name
     */
    function normalize(name, baseName) {
        var nameParts, nameSegment, mapValue, foundMap, lastIndex,
            foundI, foundStarMap, starI, i, j, part,
            baseParts = baseName && baseName.split("/"),
            map = config.map,
            starMap = (map && map['*']) || {};

        //Adjust any relative paths.
        if (name && name.charAt(0) === ".") {
            //If have a base name, try to normalize against it,
            //otherwise, assume it is a top-level require that will
            //be relative to baseUrl in the end.
            if (baseName) {
                name = name.split('/');
                lastIndex = name.length - 1;

                // Node .js allowance:
                if (config.nodeIdCompat && jsSuffixRegExp.test(name[lastIndex])) {
                    name[lastIndex] = name[lastIndex].replace(jsSuffixRegExp, '');
                }

                //Lop off the last part of baseParts, so that . matches the
                //"directory" and not name of the baseName's module. For instance,
                //baseName of "one/two/three", maps to "one/two/three.js", but we
                //want the directory, "one/two" for this normalization.
                name = baseParts.slice(0, baseParts.length - 1).concat(name);

                //start trimDots
                for (i = 0; i < name.length; i += 1) {
                    part = name[i];
                    if (part === ".") {
                        name.splice(i, 1);
                        i -= 1;
                    } else if (part === "..") {
                        if (i === 1 && (name[2] === '..' || name[0] === '..')) {
                            //End of the line. Keep at least one non-dot
                            //path segment at the front so it can be mapped
                            //correctly to disk. Otherwise, there is likely
                            //no path mapping for a path starting with '..'.
                            //This can still fail, but catches the most reasonable
                            //uses of ..
                            break;
                        } else if (i > 0) {
                            name.splice(i - 1, 2);
                            i -= 2;
                        }
                    }
                }
                //end trimDots

                name = name.join("/");
            } else if (name.indexOf('./') === 0) {
                // No baseName, so this is ID is resolved relative
                // to baseUrl, pull off the leading dot.
                name = name.substring(2);
            }
        }

        //Apply map config if available.
        if ((baseParts || starMap) && map) {
            nameParts = name.split('/');

            for (i = nameParts.length; i > 0; i -= 1) {
                nameSegment = nameParts.slice(0, i).join("/");

                if (baseParts) {
                    //Find the longest baseName segment match in the config.
                    //So, do joins on the biggest to smallest lengths of baseParts.
                    for (j = baseParts.length; j > 0; j -= 1) {
                        mapValue = map[baseParts.slice(0, j).join('/')];

                        //baseName segment has  config, find if it has one for
                        //this name.
                        if (mapValue) {
                            mapValue = mapValue[nameSegment];
                            if (mapValue) {
                                //Match, update name to the new value.
                                foundMap = mapValue;
                                foundI = i;
                                break;
                            }
                        }
                    }
                }

                if (foundMap) {
                    break;
                }

                //Check for a star map match, but just hold on to it,
                //if there is a shorter segment match later in a matching
                //config, then favor over this star map.
                if (!foundStarMap && starMap && starMap[nameSegment]) {
                    foundStarMap = starMap[nameSegment];
                    starI = i;
                }
            }

            if (!foundMap && foundStarMap) {
                foundMap = foundStarMap;
                foundI = starI;
            }

            if (foundMap) {
                nameParts.splice(0, foundI, foundMap);
                name = nameParts.join('/');
            }
        }

        return name;
    }

    function makeRequire(relName, forceSync) {
        return function () {
            //A version of a require function that passes a moduleName
            //value for items that may need to
            //look up paths relative to the moduleName
            var args = aps.call(arguments, 0);

            //If first arg is not require('string'), and there is only
            //one arg, it is the array form without a callback. Insert
            //a null so that the following concat is correct.
            if (typeof args[0] !== 'string' && args.length === 1) {
                args.push(null);
            }
            return req.apply(undef, args.concat([relName, forceSync]));
        };
    }

    function makeNormalize(relName) {
        return function (name) {
            return normalize(name, relName);
        };
    }

    function makeLoad(depName) {
        return function (value) {
            defined[depName] = value;
        };
    }

    function callDep(name) {
        if (hasProp(waiting, name)) {
            var args = waiting[name];
            delete waiting[name];
            defining[name] = true;
            main.apply(undef, args);
        }

        if (!hasProp(defined, name) && !hasProp(defining, name)) {
            throw new Error('No ' + name);
        }
        return defined[name];
    }

    //Turns a plugin!resource to [plugin, resource]
    //with the plugin being undefined if the name
    //did not have a plugin prefix.
    function splitPrefix(name) {
        var prefix,
            index = name ? name.indexOf('!') : -1;
        if (index > -1) {
            prefix = name.substring(0, index);
            name = name.substring(index + 1, name.length);
        }
        return [prefix, name];
    }

    /**
     * Makes a name map, normalizing the name, and using a plugin
     * for normalization if necessary. Grabs a ref to plugin
     * too, as an optimization.
     */
    makeMap = function (name, relName) {
        var plugin,
            parts = splitPrefix(name),
            prefix = parts[0];

        name = parts[1];

        if (prefix) {
            prefix = normalize(prefix, relName);
            plugin = callDep(prefix);
        }

        //Normalize according
        if (prefix) {
            if (plugin && plugin.normalize) {
                name = plugin.normalize(name, makeNormalize(relName));
            } else {
                name = normalize(name, relName);
            }
        } else {
            name = normalize(name, relName);
            parts = splitPrefix(name);
            prefix = parts[0];
            name = parts[1];
            if (prefix) {
                plugin = callDep(prefix);
            }
        }

        //Using ridiculous property names for space reasons
        return {
            f: prefix ? prefix + '!' + name : name, //fullName
            n: name,
            pr: prefix,
            p: plugin
        };
    };

    function makeConfig(name) {
        return function () {
            return (config && config.config && config.config[name]) || {};
        };
    }

    handlers = {
        require: function (name) {
            return makeRequire(name);
        },
        exports: function (name) {
            var e = defined[name];
            if (typeof e !== 'undefined') {
                return e;
            } else {
                return (defined[name] = {});
            }
        },
        module: function (name) {
            return {
                id: name,
                uri: '',
                exports: defined[name],
                config: makeConfig(name)
            };
        }
    };

    main = function (name, deps, callback, relName) {
        var cjsModule, depName, ret, map, i,
            args = [],
            callbackType = typeof callback,
            usingExports;

        //Use name if no relName
        relName = relName || name;

        //Call the callback to define the module, if necessary.
        if (callbackType === 'undefined' || callbackType === 'function') {
            //Pull out the defined dependencies and pass the ordered
            //values to the callback.
            //Default to [require, exports, module] if no deps
            deps = !deps.length && callback.length ? ['require', 'exports', 'module'] : deps;
            for (i = 0; i < deps.length; i += 1) {
                map = makeMap(deps[i], relName);
                depName = map.f;

                //Fast path CommonJS standard dependencies.
                if (depName === "require") {
                    args[i] = handlers.require(name);
                } else if (depName === "exports") {
                    //CommonJS module spec 1.1
                    args[i] = handlers.exports(name);
                    usingExports = true;
                } else if (depName === "module") {
                    //CommonJS module spec 1.1
                    cjsModule = args[i] = handlers.module(name);
                } else if (hasProp(defined, depName) ||
                           hasProp(waiting, depName) ||
                           hasProp(defining, depName)) {
                    args[i] = callDep(depName);
                } else if (map.p) {
                    map.p.load(map.n, makeRequire(relName, true), makeLoad(depName), {});
                    args[i] = defined[depName];
                } else {
                    throw new Error(name + ' missing ' + depName);
                }
            }

            ret = callback ? callback.apply(defined[name], args) : undefined;

            if (name) {
                //If setting exports via "module" is in play,
                //favor that over return value and exports. After that,
                //favor a non-undefined return value over exports use.
                if (cjsModule && cjsModule.exports !== undef &&
                        cjsModule.exports !== defined[name]) {
                    defined[name] = cjsModule.exports;
                } else if (ret !== undef || !usingExports) {
                    //Use the return value from the function.
                    defined[name] = ret;
                }
            }
        } else if (name) {
            //May just be an object definition for the module. Only
            //worry about defining if have a module name.
            defined[name] = callback;
        }
    };

    requirejs = require = req = function (deps, callback, relName, forceSync, alt) {
        if (typeof deps === "string") {
            if (handlers[deps]) {
                //callback in this case is really relName
                return handlers[deps](callback);
            }
            //Just return the module wanted. In this scenario, the
            //deps arg is the module name, and second arg (if passed)
            //is just the relName.
            //Normalize module name, if it contains . or ..
            return callDep(makeMap(deps, callback).f);
        } else if (!deps.splice) {
            //deps is a config object, not an array.
            config = deps;
            if (config.deps) {
                req(config.deps, config.callback);
            }
            if (!callback) {
                return;
            }

            if (callback.splice) {
                //callback is an array, which means it is a dependency list.
                //Adjust args if there are dependencies
                deps = callback;
                callback = relName;
                relName = null;
            } else {
                deps = undef;
            }
        }

        //Support require(['a'])
        callback = callback || function () {};

        //If relName is a function, it is an errback handler,
        //so remove it.
        if (typeof relName === 'function') {
            relName = forceSync;
            forceSync = alt;
        }

        //Simulate async callback;
        if (forceSync) {
            main(undef, deps, callback, relName);
        } else {
            //Using a non-zero value because of concern for what old browsers
            //do, and latest browsers "upgrade" to 4 if lower value is used:
            //http://www.whatwg.org/specs/web-apps/current-work/multipage/timers.html#dom-windowtimers-settimeout:
            //If want a value immediately, use require('id') instead -- something
            //that works in almond on the global level, but not guaranteed and
            //unlikely to work in other AMD implementations.
            setTimeout(function () {
                main(undef, deps, callback, relName);
            }, 4);
        }

        return req;
    };

    /**
     * Just drops the config on the floor, but returns req in case
     * the config return value is used.
     */
    req.config = function (cfg) {
        return req(cfg);
    };

    /**
     * Expose module registry for debugging and tooling
     */
    requirejs._defined = defined;

    define = function (name, deps, callback) {
        if (typeof name !== 'string') {
            throw new Error('See almond README: incorrect module build, no module name');
        }

        //This module may not have dependencies
        if (!deps.splice) {
            //deps is not an array, so probably means
            //an object literal or factory function for
            //the value. Adjust args.
            callback = deps;
            deps = [];
        }

        if (!hasProp(defined, name) && !hasProp(waiting, name)) {
            waiting[name] = [name, deps, callback];
        }
    };

    define.amd = {
        jQuery: true
    };
}());
/*!
 * jQuery JavaScript Library v1.9.1
 * http://jquery.com/
 *
 * Includes Sizzle.js
 * http://sizzlejs.com/
 *
 * Copyright 2005, 2012 jQuery Foundation, Inc. and other contributors
 * Released under the MIT license
 * http://jquery.org/license
 *
 * Date: 2013-2-4
 */

(function( window, undefined ) {

// Can't do this because several apps including ASP.NET trace
// the stack via arguments.caller.callee and Firefox dies if
// you try to trace through "use strict" call chains. (#13335)
// Support: Firefox 18+
//"use strict";
var
	// The deferred used on DOM ready
	readyList,

	// A central reference to the root jQuery(document)
	rootjQuery,

	// Support: IE<9
	// For `typeof node.method` instead of `node.method !== undefined`
	core_strundefined = typeof undefined,

	// Use the correct document accordingly with window argument (sandbox)
	document = window.document,
	location = window.location,

	// Map over jQuery in case of overwrite
	_jQuery = window.jQuery,

	// Map over the $ in case of overwrite
	_$ = window.$,

	// [[Class]] -> type pairs
	class2type = {},

	// List of deleted data cache ids, so we can reuse them
	core_deletedIds = [],

	core_version = "1.9.1",

	// Save a reference to some core methods
	core_concat = core_deletedIds.concat,
	core_push = core_deletedIds.push,
	core_slice = core_deletedIds.slice,
	core_indexOf = core_deletedIds.indexOf,
	core_toString = class2type.toString,
	core_hasOwn = class2type.hasOwnProperty,
	core_trim = core_version.trim,

	// Define a local copy of jQuery
	jQuery = function( selector, context ) {
		// The jQuery object is actually just the init constructor 'enhanced'
		return new jQuery.fn.init( selector, context, rootjQuery );
	},

	// Used for matching numbers
	core_pnum = /[+-]?(?:\d*\.|)\d+(?:[eE][+-]?\d+|)/.source,

	// Used for splitting on whitespace
	core_rnotwhite = /\S+/g,

	// Make sure we trim BOM and NBSP (here's looking at you, Safari 5.0 and IE)
	rtrim = /^[\s\uFEFF\xA0]+|[\s\uFEFF\xA0]+$/g,

	// A simple way to check for HTML strings
	// Prioritize #id over <tag> to avoid XSS via location.hash (#9521)
	// Strict HTML recognition (#11290: must start with <)
	rquickExpr = /^(?:(<[\w\W]+>)[^>]*|#([\w-]*))$/,

	// Match a standalone tag
	rsingleTag = /^<(\w+)\s*\/?>(?:<\/\1>|)$/,

	// JSON RegExp
	rvalidchars = /^[\],:{}\s]*$/,
	rvalidbraces = /(?:^|:|,)(?:\s*\[)+/g,
	rvalidescape = /\\(?:["\\\/bfnrt]|u[\da-fA-F]{4})/g,
	rvalidtokens = /"[^"\\\r\n]*"|true|false|null|-?(?:\d+\.|)\d+(?:[eE][+-]?\d+|)/g,

	// Matches dashed string for camelizing
	rmsPrefix = /^-ms-/,
	rdashAlpha = /-([\da-z])/gi,

	// Used by jQuery.camelCase as callback to replace()
	fcamelCase = function( all, letter ) {
		return letter.toUpperCase();
	},

	// The ready event handler
	completed = function( event ) {

		// readyState === "complete" is good enough for us to call the dom ready in oldIE
		if ( document.addEventListener || event.type === "load" || document.readyState === "complete" ) {
			detach();
			jQuery.ready();
		}
	},
	// Clean-up method for dom ready events
	detach = function() {
		if ( document.addEventListener ) {
			document.removeEventListener( "DOMContentLoaded", completed, false );
			window.removeEventListener( "load", completed, false );

		} else {
			document.detachEvent( "onreadystatechange", completed );
			window.detachEvent( "onload", completed );
		}
	};

jQuery.fn = jQuery.prototype = {
	// The current version of jQuery being used
	jquery: core_version,

	constructor: jQuery,
	init: function( selector, context, rootjQuery ) {
		var match, elem;

		// HANDLE: $(""), $(null), $(undefined), $(false)
		if ( !selector ) {
			return this;
		}

		// Handle HTML strings
		if ( typeof selector === "string" ) {
			if ( selector.charAt(0) === "<" && selector.charAt( selector.length - 1 ) === ">" && selector.length >= 3 ) {
				// Assume that strings that start and end with <> are HTML and skip the regex check
				match = [ null, selector, null ];

			} else {
				match = rquickExpr.exec( selector );
			}

			// Match html or make sure no context is specified for #id
			if ( match && (match[1] || !context) ) {

				// HANDLE: $(html) -> $(array)
				if ( match[1] ) {
					context = context instanceof jQuery ? context[0] : context;

					// scripts is true for back-compat
					jQuery.merge( this, jQuery.parseHTML(
						match[1],
						context && context.nodeType ? context.ownerDocument || context : document,
						true
					) );

					// HANDLE: $(html, props)
					if ( rsingleTag.test( match[1] ) && jQuery.isPlainObject( context ) ) {
						for ( match in context ) {
							// Properties of context are called as methods if possible
							if ( jQuery.isFunction( this[ match ] ) ) {
								this[ match ]( context[ match ] );

							// ...and otherwise set as attributes
							} else {
								this.attr( match, context[ match ] );
							}
						}
					}

					return this;

				// HANDLE: $(#id)
				} else {
					elem = document.getElementById( match[2] );

					// Check parentNode to catch when Blackberry 4.6 returns
					// nodes that are no longer in the document #6963
					if ( elem && elem.parentNode ) {
						// Handle the case where IE and Opera return items
						// by name instead of ID
						if ( elem.id !== match[2] ) {
							return rootjQuery.find( selector );
						}

						// Otherwise, we inject the element directly into the jQuery object
						this.length = 1;
						this[0] = elem;
					}

					this.context = document;
					this.selector = selector;
					return this;
				}

			// HANDLE: $(expr, $(...))
			} else if ( !context || context.jquery ) {
				return ( context || rootjQuery ).find( selector );

			// HANDLE: $(expr, context)
			// (which is just equivalent to: $(context).find(expr)
			} else {
				return this.constructor( context ).find( selector );
			}

		// HANDLE: $(DOMElement)
		} else if ( selector.nodeType ) {
			this.context = this[0] = selector;
			this.length = 1;
			return this;

		// HANDLE: $(function)
		// Shortcut for document ready
		} else if ( jQuery.isFunction( selector ) ) {
			return rootjQuery.ready( selector );
		}

		if ( selector.selector !== undefined ) {
			this.selector = selector.selector;
			this.context = selector.context;
		}

		return jQuery.makeArray( selector, this );
	},

	// Start with an empty selector
	selector: "",

	// The default length of a jQuery object is 0
	length: 0,

	// The number of elements contained in the matched element set
	size: function() {
		return this.length;
	},

	toArray: function() {
		return core_slice.call( this );
	},

	// Get the Nth element in the matched element set OR
	// Get the whole matched element set as a clean array
	get: function( num ) {
		return num == null ?

			// Return a 'clean' array
			this.toArray() :

			// Return just the object
			( num < 0 ? this[ this.length + num ] : this[ num ] );
	},

	// Take an array of elements and push it onto the stack
	// (returning the new matched element set)
	pushStack: function( elems ) {

		// Build a new jQuery matched element set
		var ret = jQuery.merge( this.constructor(), elems );

		// Add the old object onto the stack (as a reference)
		ret.prevObject = this;
		ret.context = this.context;

		// Return the newly-formed element set
		return ret;
	},

	// Execute a callback for every element in the matched set.
	// (You can seed the arguments with an array of args, but this is
	// only used internally.)
	each: function( callback, args ) {
		return jQuery.each( this, callback, args );
	},

	ready: function( fn ) {
		// Add the callback
		jQuery.ready.promise().done( fn );

		return this;
	},

	slice: function() {
		return this.pushStack( core_slice.apply( this, arguments ) );
	},

	first: function() {
		return this.eq( 0 );
	},

	last: function() {
		return this.eq( -1 );
	},

	eq: function( i ) {
		var len = this.length,
			j = +i + ( i < 0 ? len : 0 );
		return this.pushStack( j >= 0 && j < len ? [ this[j] ] : [] );
	},

	map: function( callback ) {
		return this.pushStack( jQuery.map(this, function( elem, i ) {
			return callback.call( elem, i, elem );
		}));
	},

	end: function() {
		return this.prevObject || this.constructor(null);
	},

	// For internal use only.
	// Behaves like an Array's method, not like a jQuery method.
	push: core_push,
	sort: [].sort,
	splice: [].splice
};

// Give the init function the jQuery prototype for later instantiation
jQuery.fn.init.prototype = jQuery.fn;

jQuery.extend = jQuery.fn.extend = function() {
	var src, copyIsArray, copy, name, options, clone,
		target = arguments[0] || {},
		i = 1,
		length = arguments.length,
		deep = false;

	// Handle a deep copy situation
	if ( typeof target === "boolean" ) {
		deep = target;
		target = arguments[1] || {};
		// skip the boolean and the target
		i = 2;
	}

	// Handle case when target is a string or something (possible in deep copy)
	if ( typeof target !== "object" && !jQuery.isFunction(target) ) {
		target = {};
	}

	// extend jQuery itself if only one argument is passed
	if ( length === i ) {
		target = this;
		--i;
	}

	for ( ; i < length; i++ ) {
		// Only deal with non-null/undefined values
		if ( (options = arguments[ i ]) != null ) {
			// Extend the base object
			for ( name in options ) {
				src = target[ name ];
				copy = options[ name ];

				// Prevent never-ending loop
				if ( target === copy ) {
					continue;
				}

				// Recurse if we're merging plain objects or arrays
				if ( deep && copy && ( jQuery.isPlainObject(copy) || (copyIsArray = jQuery.isArray(copy)) ) ) {
					if ( copyIsArray ) {
						copyIsArray = false;
						clone = src && jQuery.isArray(src) ? src : [];

					} else {
						clone = src && jQuery.isPlainObject(src) ? src : {};
					}

					// Never move original objects, clone them
					target[ name ] = jQuery.extend( deep, clone, copy );

				// Don't bring in undefined values
				} else if ( copy !== undefined ) {
					target[ name ] = copy;
				}
			}
		}
	}

	// Return the modified object
	return target;
};

jQuery.extend({
	noConflict: function( deep ) {
		if ( window.$ === jQuery ) {
			window.$ = _$;
		}

		if ( deep && window.jQuery === jQuery ) {
			window.jQuery = _jQuery;
		}

		return jQuery;
	},

	// Is the DOM ready to be used? Set to true once it occurs.
	isReady: false,

	// A counter to track how many items to wait for before
	// the ready event fires. See #6781
	readyWait: 1,

	// Hold (or release) the ready event
	holdReady: function( hold ) {
		if ( hold ) {
			jQuery.readyWait++;
		} else {
			jQuery.ready( true );
		}
	},

	// Handle when the DOM is ready
	ready: function( wait ) {

		// Abort if there are pending holds or we're already ready
		if ( wait === true ? --jQuery.readyWait : jQuery.isReady ) {
			return;
		}

		// Make sure body exists, at least, in case IE gets a little overzealous (ticket #5443).
		if ( !document.body ) {
			return setTimeout( jQuery.ready );
		}

		// Remember that the DOM is ready
		jQuery.isReady = true;

		// If a normal DOM Ready event fired, decrement, and wait if need be
		if ( wait !== true && --jQuery.readyWait > 0 ) {
			return;
		}

		// If there are functions bound, to execute
		readyList.resolveWith( document, [ jQuery ] );

		// Trigger any bound ready events
		if ( jQuery.fn.trigger ) {
			jQuery( document ).trigger("ready").off("ready");
		}
	},

	// See test/unit/core.js for details concerning isFunction.
	// Since version 1.3, DOM methods and functions like alert
	// aren't supported. They return false on IE (#2968).
	isFunction: function( obj ) {
		return jQuery.type(obj) === "function";
	},

	isArray: Array.isArray || function( obj ) {
		return jQuery.type(obj) === "array";
	},

	isWindow: function( obj ) {
		return obj != null && obj == obj.window;
	},

	isNumeric: function( obj ) {
		return !isNaN( parseFloat(obj) ) && isFinite( obj );
	},

	type: function( obj ) {
		if ( obj == null ) {
			return String( obj );
		}
		return typeof obj === "object" || typeof obj === "function" ?
			class2type[ core_toString.call(obj) ] || "object" :
			typeof obj;
	},

	isPlainObject: function( obj ) {
		// Must be an Object.
		// Because of IE, we also have to check the presence of the constructor property.
		// Make sure that DOM nodes and window objects don't pass through, as well
		if ( !obj || jQuery.type(obj) !== "object" || obj.nodeType || jQuery.isWindow( obj ) ) {
			return false;
		}

		try {
			// Not own constructor property must be Object
			if ( obj.constructor &&
				!core_hasOwn.call(obj, "constructor") &&
				!core_hasOwn.call(obj.constructor.prototype, "isPrototypeOf") ) {
				return false;
			}
		} catch ( e ) {
			// IE8,9 Will throw exceptions on certain host objects #9897
			return false;
		}

		// Own properties are enumerated firstly, so to speed up,
		// if last one is own, then all properties are own.

		var key;
		for ( key in obj ) {}

		return key === undefined || core_hasOwn.call( obj, key );
	},

	isEmptyObject: function( obj ) {
		var name;
		for ( name in obj ) {
			return false;
		}
		return true;
	},

	error: function( msg ) {
		throw new Error( msg );
	},

	// data: string of html
	// context (optional): If specified, the fragment will be created in this context, defaults to document
	// keepScripts (optional): If true, will include scripts passed in the html string
	parseHTML: function( data, context, keepScripts ) {
		if ( !data || typeof data !== "string" ) {
			return null;
		}
		if ( typeof context === "boolean" ) {
			keepScripts = context;
			context = false;
		}
		context = context || document;

		var parsed = rsingleTag.exec( data ),
			scripts = !keepScripts && [];

		// Single tag
		if ( parsed ) {
			return [ context.createElement( parsed[1] ) ];
		}

		parsed = jQuery.buildFragment( [ data ], context, scripts );
		if ( scripts ) {
			jQuery( scripts ).remove();
		}
		return jQuery.merge( [], parsed.childNodes );
	},

	parseJSON: function( data ) {
		// Attempt to parse using the native JSON parser first
		if ( window.JSON && window.JSON.parse ) {
			return window.JSON.parse( data );
		}

		if ( data === null ) {
			return data;
		}

		if ( typeof data === "string" ) {

			// Make sure leading/trailing whitespace is removed (IE can't handle it)
			data = jQuery.trim( data );

			if ( data ) {
				// Make sure the incoming data is actual JSON
				// Logic borrowed from http://json.org/json2.js
				if ( rvalidchars.test( data.replace( rvalidescape, "@" )
					.replace( rvalidtokens, "]" )
					.replace( rvalidbraces, "")) ) {

					return ( new Function( "return " + data ) )();
				}
			}
		}

		jQuery.error( "Invalid JSON: " + data );
	},

	// Cross-browser xml parsing
	parseXML: function( data ) {
		var xml, tmp;
		if ( !data || typeof data !== "string" ) {
			return null;
		}
		try {
			if ( window.DOMParser ) { // Standard
				tmp = new DOMParser();
				xml = tmp.parseFromString( data , "text/xml" );
			} else { // IE
				xml = new ActiveXObject( "Microsoft.XMLDOM" );
				xml.async = "false";
				xml.loadXML( data );
			}
		} catch( e ) {
			xml = undefined;
		}
		if ( !xml || !xml.documentElement || xml.getElementsByTagName( "parsererror" ).length ) {
			jQuery.error( "Invalid XML: " + data );
		}
		return xml;
	},

	noop: function() {},

	// Evaluates a script in a global context
	// Workarounds based on findings by Jim Driscoll
	// http://weblogs.java.net/blog/driscoll/archive/2009/09/08/eval-javascript-global-context
	globalEval: function( data ) {
		if ( data && jQuery.trim( data ) ) {
			// We use execScript on Internet Explorer
			// We use an anonymous function so that context is window
			// rather than jQuery in Firefox
			( window.execScript || function( data ) {
				window[ "eval" ].call( window, data );
			} )( data );
		}
	},

	// Convert dashed to camelCase; used by the css and data modules
	// Microsoft forgot to hump their vendor prefix (#9572)
	camelCase: function( string ) {
		return string.replace( rmsPrefix, "ms-" ).replace( rdashAlpha, fcamelCase );
	},

	nodeName: function( elem, name ) {
		return elem.nodeName && elem.nodeName.toLowerCase() === name.toLowerCase();
	},

	// args is for internal usage only
	each: function( obj, callback, args ) {
		var value,
			i = 0,
			length = obj.length,
			isArray = isArraylike( obj );

		if ( args ) {
			if ( isArray ) {
				for ( ; i < length; i++ ) {
					value = callback.apply( obj[ i ], args );

					if ( value === false ) {
						break;
					}
				}
			} else {
				for ( i in obj ) {
					value = callback.apply( obj[ i ], args );

					if ( value === false ) {
						break;
					}
				}
			}

		// A special, fast, case for the most common use of each
		} else {
			if ( isArray ) {
				for ( ; i < length; i++ ) {
					value = callback.call( obj[ i ], i, obj[ i ] );

					if ( value === false ) {
						break;
					}
				}
			} else {
				for ( i in obj ) {
					value = callback.call( obj[ i ], i, obj[ i ] );

					if ( value === false ) {
						break;
					}
				}
			}
		}

		return obj;
	},

	// Use native String.trim function wherever possible
	trim: core_trim && !core_trim.call("\uFEFF\xA0") ?
		function( text ) {
			return text == null ?
				"" :
				core_trim.call( text );
		} :

		// Otherwise use our own trimming functionality
		function( text ) {
			return text == null ?
				"" :
				( text + "" ).replace( rtrim, "" );
		},

	// results is for internal usage only
	makeArray: function( arr, results ) {
		var ret = results || [];

		if ( arr != null ) {
			if ( isArraylike( Object(arr) ) ) {
				jQuery.merge( ret,
					typeof arr === "string" ?
					[ arr ] : arr
				);
			} else {
				core_push.call( ret, arr );
			}
		}

		return ret;
	},

	inArray: function( elem, arr, i ) {
		var len;

		if ( arr ) {
			if ( core_indexOf ) {
				return core_indexOf.call( arr, elem, i );
			}

			len = arr.length;
			i = i ? i < 0 ? Math.max( 0, len + i ) : i : 0;

			for ( ; i < len; i++ ) {
				// Skip accessing in sparse arrays
				if ( i in arr && arr[ i ] === elem ) {
					return i;
				}
			}
		}

		return -1;
	},

	merge: function( first, second ) {
		var l = second.length,
			i = first.length,
			j = 0;

		if ( typeof l === "number" ) {
			for ( ; j < l; j++ ) {
				first[ i++ ] = second[ j ];
			}
		} else {
			while ( second[j] !== undefined ) {
				first[ i++ ] = second[ j++ ];
			}
		}

		first.length = i;

		return first;
	},

	grep: function( elems, callback, inv ) {
		var retVal,
			ret = [],
			i = 0,
			length = elems.length;
		inv = !!inv;

		// Go through the array, only saving the items
		// that pass the validator function
		for ( ; i < length; i++ ) {
			retVal = !!callback( elems[ i ], i );
			if ( inv !== retVal ) {
				ret.push( elems[ i ] );
			}
		}

		return ret;
	},

	// arg is for internal usage only
	map: function( elems, callback, arg ) {
		var value,
			i = 0,
			length = elems.length,
			isArray = isArraylike( elems ),
			ret = [];

		// Go through the array, translating each of the items to their
		if ( isArray ) {
			for ( ; i < length; i++ ) {
				value = callback( elems[ i ], i, arg );

				if ( value != null ) {
					ret[ ret.length ] = value;
				}
			}

		// Go through every key on the object,
		} else {
			for ( i in elems ) {
				value = callback( elems[ i ], i, arg );

				if ( value != null ) {
					ret[ ret.length ] = value;
				}
			}
		}

		// Flatten any nested arrays
		return core_concat.apply( [], ret );
	},

	// A global GUID counter for objects
	guid: 1,

	// Bind a function to a context, optionally partially applying any
	// arguments.
	proxy: function( fn, context ) {
		var args, proxy, tmp;

		if ( typeof context === "string" ) {
			tmp = fn[ context ];
			context = fn;
			fn = tmp;
		}

		// Quick check to determine if target is callable, in the spec
		// this throws a TypeError, but we will just return undefined.
		if ( !jQuery.isFunction( fn ) ) {
			return undefined;
		}

		// Simulated bind
		args = core_slice.call( arguments, 2 );
		proxy = function() {
			return fn.apply( context || this, args.concat( core_slice.call( arguments ) ) );
		};

		// Set the guid of unique handler to the same of original handler, so it can be removed
		proxy.guid = fn.guid = fn.guid || jQuery.guid++;

		return proxy;
	},

	// Multifunctional method to get and set values of a collection
	// The value/s can optionally be executed if it's a function
	access: function( elems, fn, key, value, chainable, emptyGet, raw ) {
		var i = 0,
			length = elems.length,
			bulk = key == null;

		// Sets many values
		if ( jQuery.type( key ) === "object" ) {
			chainable = true;
			for ( i in key ) {
				jQuery.access( elems, fn, i, key[i], true, emptyGet, raw );
			}

		// Sets one value
		} else if ( value !== undefined ) {
			chainable = true;

			if ( !jQuery.isFunction( value ) ) {
				raw = true;
			}

			if ( bulk ) {
				// Bulk operations run against the entire set
				if ( raw ) {
					fn.call( elems, value );
					fn = null;

				// ...except when executing function values
				} else {
					bulk = fn;
					fn = function( elem, key, value ) {
						return bulk.call( jQuery( elem ), value );
					};
				}
			}

			if ( fn ) {
				for ( ; i < length; i++ ) {
					fn( elems[i], key, raw ? value : value.call( elems[i], i, fn( elems[i], key ) ) );
				}
			}
		}

		return chainable ?
			elems :

			// Gets
			bulk ?
				fn.call( elems ) :
				length ? fn( elems[0], key ) : emptyGet;
	},

	now: function() {
		return ( new Date() ).getTime();
	}
});

jQuery.ready.promise = function( obj ) {
	if ( !readyList ) {

		readyList = jQuery.Deferred();

		// Catch cases where $(document).ready() is called after the browser event has already occurred.
		// we once tried to use readyState "interactive" here, but it caused issues like the one
		// discovered by ChrisS here: http://bugs.jquery.com/ticket/12282#comment:15
		if ( document.readyState === "complete" ) {
			// Handle it asynchronously to allow scripts the opportunity to delay ready
			setTimeout( jQuery.ready );

		// Standards-based browsers support DOMContentLoaded
		} else if ( document.addEventListener ) {
			// Use the handy event callback
			document.addEventListener( "DOMContentLoaded", completed, false );

			// A fallback to window.onload, that will always work
			window.addEventListener( "load", completed, false );

		// If IE event model is used
		} else {
			// Ensure firing before onload, maybe late but safe also for iframes
			document.attachEvent( "onreadystatechange", completed );

			// A fallback to window.onload, that will always work
			window.attachEvent( "onload", completed );

			// If IE and not a frame
			// continually check to see if the document is ready
			var top = false;

			try {
				top = window.frameElement == null && document.documentElement;
			} catch(e) {}

			if ( top && top.doScroll ) {
				(function doScrollCheck() {
					if ( !jQuery.isReady ) {

						try {
							// Use the trick by Diego Perini
							// http://javascript.nwbox.com/IEContentLoaded/
							top.doScroll("left");
						} catch(e) {
							return setTimeout( doScrollCheck, 50 );
						}

						// detach all dom ready events
						detach();

						// and execute any waiting functions
						jQuery.ready();
					}
				})();
			}
		}
	}
	return readyList.promise( obj );
};

// Populate the class2type map
jQuery.each("Boolean Number String Function Array Date RegExp Object Error".split(" "), function(i, name) {
	class2type[ "[object " + name + "]" ] = name.toLowerCase();
});

function isArraylike( obj ) {
	var length = obj.length,
		type = jQuery.type( obj );

	if ( jQuery.isWindow( obj ) ) {
		return false;
	}

	if ( obj.nodeType === 1 && length ) {
		return true;
	}

	return type === "array" || type !== "function" &&
		( length === 0 ||
		typeof length === "number" && length > 0 && ( length - 1 ) in obj );
}

// All jQuery objects should point back to these
rootjQuery = jQuery(document);
// String to Object options format cache
var optionsCache = {};

// Convert String-formatted options into Object-formatted ones and store in cache
function createOptions( options ) {
	var object = optionsCache[ options ] = {};
	jQuery.each( options.match( core_rnotwhite ) || [], function( _, flag ) {
		object[ flag ] = true;
	});
	return object;
}

/*
 * Create a callback list using the following parameters:
 *
 *	options: an optional list of space-separated options that will change how
 *			the callback list behaves or a more traditional option object
 *
 * By default a callback list will act like an event callback list and can be
 * "fired" multiple times.
 *
 * Possible options:
 *
 *	once:			will ensure the callback list can only be fired once (like a Deferred)
 *
 *	memory:			will keep track of previous values and will call any callback added
 *					after the list has been fired right away with the latest "memorized"
 *					values (like a Deferred)
 *
 *	unique:			will ensure a callback can only be added once (no duplicate in the list)
 *
 *	stopOnFalse:	interrupt callings when a callback returns false
 *
 */
jQuery.Callbacks = function( options ) {

	// Convert options from String-formatted to Object-formatted if needed
	// (we check in cache first)
	options = typeof options === "string" ?
		( optionsCache[ options ] || createOptions( options ) ) :
		jQuery.extend( {}, options );

	var // Flag to know if list is currently firing
		firing,
		// Last fire value (for non-forgettable lists)
		memory,
		// Flag to know if list was already fired
		fired,
		// End of the loop when firing
		firingLength,
		// Index of currently firing callback (modified by remove if needed)
		firingIndex,
		// First callback to fire (used internally by add and fireWith)
		firingStart,
		// Actual callback list
		list = [],
		// Stack of fire calls for repeatable lists
		stack = !options.once && [],
		// Fire callbacks
		fire = function( data ) {
			memory = options.memory && data;
			fired = true;
			firingIndex = firingStart || 0;
			firingStart = 0;
			firingLength = list.length;
			firing = true;
			for ( ; list && firingIndex < firingLength; firingIndex++ ) {
				if ( list[ firingIndex ].apply( data[ 0 ], data[ 1 ] ) === false && options.stopOnFalse ) {
					memory = false; // To prevent further calls using add
					break;
				}
			}
			firing = false;
			if ( list ) {
				if ( stack ) {
					if ( stack.length ) {
						fire( stack.shift() );
					}
				} else if ( memory ) {
					list = [];
				} else {
					self.disable();
				}
			}
		},
		// Actual Callbacks object
		self = {
			// Add a callback or a collection of callbacks to the list
			add: function() {
				if ( list ) {
					// First, we save the current length
					var start = list.length;
					(function add( args ) {
						jQuery.each( args, function( _, arg ) {
							var type = jQuery.type( arg );
							if ( type === "function" ) {
								if ( !options.unique || !self.has( arg ) ) {
									list.push( arg );
								}
							} else if ( arg && arg.length && type !== "string" ) {
								// Inspect recursively
								add( arg );
							}
						});
					})( arguments );
					// Do we need to add the callbacks to the
					// current firing batch?
					if ( firing ) {
						firingLength = list.length;
					// With memory, if we're not firing then
					// we should call right away
					} else if ( memory ) {
						firingStart = start;
						fire( memory );
					}
				}
				return this;
			},
			// Remove a callback from the list
			remove: function() {
				if ( list ) {
					jQuery.each( arguments, function( _, arg ) {
						var index;
						while( ( index = jQuery.inArray( arg, list, index ) ) > -1 ) {
							list.splice( index, 1 );
							// Handle firing indexes
							if ( firing ) {
								if ( index <= firingLength ) {
									firingLength--;
								}
								if ( index <= firingIndex ) {
									firingIndex--;
								}
							}
						}
					});
				}
				return this;
			},
			// Check if a given callback is in the list.
			// If no argument is given, return whether or not list has callbacks attached.
			has: function( fn ) {
				return fn ? jQuery.inArray( fn, list ) > -1 : !!( list && list.length );
			},
			// Remove all callbacks from the list
			empty: function() {
				list = [];
				return this;
			},
			// Have the list do nothing anymore
			disable: function() {
				list = stack = memory = undefined;
				return this;
			},
			// Is it disabled?
			disabled: function() {
				return !list;
			},
			// Lock the list in its current state
			lock: function() {
				stack = undefined;
				if ( !memory ) {
					self.disable();
				}
				return this;
			},
			// Is it locked?
			locked: function() {
				return !stack;
			},
			// Call all callbacks with the given context and arguments
			fireWith: function( context, args ) {
				args = args || [];
				args = [ context, args.slice ? args.slice() : args ];
				if ( list && ( !fired || stack ) ) {
					if ( firing ) {
						stack.push( args );
					} else {
						fire( args );
					}
				}
				return this;
			},
			// Call all the callbacks with the given arguments
			fire: function() {
				self.fireWith( this, arguments );
				return this;
			},
			// To know if the callbacks have already been called at least once
			fired: function() {
				return !!fired;
			}
		};

	return self;
};
jQuery.extend({

	Deferred: function( func ) {
		var tuples = [
				// action, add listener, listener list, final state
				[ "resolve", "done", jQuery.Callbacks("once memory"), "resolved" ],
				[ "reject", "fail", jQuery.Callbacks("once memory"), "rejected" ],
				[ "notify", "progress", jQuery.Callbacks("memory") ]
			],
			state = "pending",
			promise = {
				state: function() {
					return state;
				},
				always: function() {
					deferred.done( arguments ).fail( arguments );
					return this;
				},
				then: function( /* fnDone, fnFail, fnProgress */ ) {
					var fns = arguments;
					return jQuery.Deferred(function( newDefer ) {
						jQuery.each( tuples, function( i, tuple ) {
							var action = tuple[ 0 ],
								fn = jQuery.isFunction( fns[ i ] ) && fns[ i ];
							// deferred[ done | fail | progress ] for forwarding actions to newDefer
							deferred[ tuple[1] ](function() {
								var returned = fn && fn.apply( this, arguments );
								if ( returned && jQuery.isFunction( returned.promise ) ) {
									returned.promise()
										.done( newDefer.resolve )
										.fail( newDefer.reject )
										.progress( newDefer.notify );
								} else {
									newDefer[ action + "With" ]( this === promise ? newDefer.promise() : this, fn ? [ returned ] : arguments );
								}
							});
						});
						fns = null;
					}).promise();
				},
				// Get a promise for this deferred
				// If obj is provided, the promise aspect is added to the object
				promise: function( obj ) {
					return obj != null ? jQuery.extend( obj, promise ) : promise;
				}
			},
			deferred = {};

		// Keep pipe for back-compat
		promise.pipe = promise.then;

		// Add list-specific methods
		jQuery.each( tuples, function( i, tuple ) {
			var list = tuple[ 2 ],
				stateString = tuple[ 3 ];

			// promise[ done | fail | progress ] = list.add
			promise[ tuple[1] ] = list.add;

			// Handle state
			if ( stateString ) {
				list.add(function() {
					// state = [ resolved | rejected ]
					state = stateString;

				// [ reject_list | resolve_list ].disable; progress_list.lock
				}, tuples[ i ^ 1 ][ 2 ].disable, tuples[ 2 ][ 2 ].lock );
			}

			// deferred[ resolve | reject | notify ]
			deferred[ tuple[0] ] = function() {
				deferred[ tuple[0] + "With" ]( this === deferred ? promise : this, arguments );
				return this;
			};
			deferred[ tuple[0] + "With" ] = list.fireWith;
		});

		// Make the deferred a promise
		promise.promise( deferred );

		// Call given func if any
		if ( func ) {
			func.call( deferred, deferred );
		}

		// All done!
		return deferred;
	},

	// Deferred helper
	when: function( subordinate /* , ..., subordinateN */ ) {
		var i = 0,
			resolveValues = core_slice.call( arguments ),
			length = resolveValues.length,

			// the count of uncompleted subordinates
			remaining = length !== 1 || ( subordinate && jQuery.isFunction( subordinate.promise ) ) ? length : 0,

			// the master Deferred. If resolveValues consist of only a single Deferred, just use that.
			deferred = remaining === 1 ? subordinate : jQuery.Deferred(),

			// Update function for both resolve and progress values
			updateFunc = function( i, contexts, values ) {
				return function( value ) {
					contexts[ i ] = this;
					values[ i ] = arguments.length > 1 ? core_slice.call( arguments ) : value;
					if( values === progressValues ) {
						deferred.notifyWith( contexts, values );
					} else if ( !( --remaining ) ) {
						deferred.resolveWith( contexts, values );
					}
				};
			},

			progressValues, progressContexts, resolveContexts;

		// add listeners to Deferred subordinates; treat others as resolved
		if ( length > 1 ) {
			progressValues = new Array( length );
			progressContexts = new Array( length );
			resolveContexts = new Array( length );
			for ( ; i < length; i++ ) {
				if ( resolveValues[ i ] && jQuery.isFunction( resolveValues[ i ].promise ) ) {
					resolveValues[ i ].promise()
						.done( updateFunc( i, resolveContexts, resolveValues ) )
						.fail( deferred.reject )
						.progress( updateFunc( i, progressContexts, progressValues ) );
				} else {
					--remaining;
				}
			}
		}

		// if we're not waiting on anything, resolve the master
		if ( !remaining ) {
			deferred.resolveWith( resolveContexts, resolveValues );
		}

		return deferred.promise();
	}
});
jQuery.support = (function() {

	var support, all, a,
		input, select, fragment,
		opt, eventName, isSupported, i,
		div = document.createElement("div");

	// Setup
	div.setAttribute( "className", "t" );
	div.innerHTML = "  <link/><table></table><a href='/a'>a</a><input type='checkbox'/>";

	// Support tests won't run in some limited or non-browser environments
	all = div.getElementsByTagName("*");
	a = div.getElementsByTagName("a")[ 0 ];
	if ( !all || !a || !all.length ) {
		return {};
	}

	// First batch of tests
	select = document.createElement("select");
	opt = select.appendChild( document.createElement("option") );
	input = div.getElementsByTagName("input")[ 0 ];

	a.style.cssText = "top:1px;float:left;opacity:.5";
	support = {
		// Test setAttribute on camelCase class. If it works, we need attrFixes when doing get/setAttribute (ie6/7)
		getSetAttribute: div.className !== "t",

		// IE strips leading whitespace when .innerHTML is used
		leadingWhitespace: div.firstChild.nodeType === 3,

		// Make sure that tbody elements aren't automatically inserted
		// IE will insert them into empty tables
		tbody: !div.getElementsByTagName("tbody").length,

		// Make sure that link elements get serialized correctly by innerHTML
		// This requires a wrapper element in IE
		htmlSerialize: !!div.getElementsByTagName("link").length,

		// Get the style information from getAttribute
		// (IE uses .cssText instead)
		style: /top/.test( a.getAttribute("style") ),

		// Make sure that URLs aren't manipulated
		// (IE normalizes it by default)
		hrefNormalized: a.getAttribute("href") === "/a",

		// Make sure that element opacity exists
		// (IE uses filter instead)
		// Use a regex to work around a WebKit issue. See #5145
		opacity: /^0.5/.test( a.style.opacity ),

		// Verify style float existence
		// (IE uses styleFloat instead of cssFloat)
		cssFloat: !!a.style.cssFloat,

		// Check the default checkbox/radio value ("" on WebKit; "on" elsewhere)
		checkOn: !!input.value,

		// Make sure that a selected-by-default option has a working selected property.
		// (WebKit defaults to false instead of true, IE too, if it's in an optgroup)
		optSelected: opt.selected,

		// Tests for enctype support on a form (#6743)
		enctype: !!document.createElement("form").enctype,

		// Makes sure cloning an html5 element does not cause problems
		// Where outerHTML is undefined, this still works
		html5Clone: document.createElement("nav").cloneNode( true ).outerHTML !== "<:nav></:nav>",

		// jQuery.support.boxModel DEPRECATED in 1.8 since we don't support Quirks Mode
		boxModel: document.compatMode === "CSS1Compat",

		// Will be defined later
		deleteExpando: true,
		noCloneEvent: true,
		inlineBlockNeedsLayout: false,
		shrinkWrapBlocks: false,
		reliableMarginRight: true,
		boxSizingReliable: true,
		pixelPosition: false
	};

	// Make sure checked status is properly cloned
	input.checked = true;
	support.noCloneChecked = input.cloneNode( true ).checked;

	// Make sure that the options inside disabled selects aren't marked as disabled
	// (WebKit marks them as disabled)
	select.disabled = true;
	support.optDisabled = !opt.disabled;

	// Support: IE<9
	try {
		delete div.test;
	} catch( e ) {
		support.deleteExpando = false;
	}

	// Check if we can trust getAttribute("value")
	input = document.createElement("input");
	input.setAttribute( "value", "" );
	support.input = input.getAttribute( "value" ) === "";

	// Check if an input maintains its value after becoming a radio
	input.value = "t";
	input.setAttribute( "type", "radio" );
	support.radioValue = input.value === "t";

	// #11217 - WebKit loses check when the name is after the checked attribute
	input.setAttribute( "checked", "t" );
	input.setAttribute( "name", "t" );

	fragment = document.createDocumentFragment();
	fragment.appendChild( input );

	// Check if a disconnected checkbox will retain its checked
	// value of true after appended to the DOM (IE6/7)
	support.appendChecked = input.checked;

	// WebKit doesn't clone checked state correctly in fragments
	support.checkClone = fragment.cloneNode( true ).cloneNode( true ).lastChild.checked;

	// Support: IE<9
	// Opera does not clone events (and typeof div.attachEvent === undefined).
	// IE9-10 clones events bound via attachEvent, but they don't trigger with .click()
	if ( div.attachEvent ) {
		div.attachEvent( "onclick", function() {
			support.noCloneEvent = false;
		});

		div.cloneNode( true ).click();
	}

	// Support: IE<9 (lack submit/change bubble), Firefox 17+ (lack focusin event)
	// Beware of CSP restrictions (https://developer.mozilla.org/en/Security/CSP), test/csp.php
	for ( i in { submit: true, change: true, focusin: true }) {
		div.setAttribute( eventName = "on" + i, "t" );

		support[ i + "Bubbles" ] = eventName in window || div.attributes[ eventName ].expando === false;
	}

	div.style.backgroundClip = "content-box";
	div.cloneNode( true ).style.backgroundClip = "";
	support.clearCloneStyle = div.style.backgroundClip === "content-box";

	// Run tests that need a body at doc ready
	jQuery(function() {
		var container, marginDiv, tds,
			divReset = "padding:0;margin:0;border:0;display:block;box-sizing:content-box;-moz-box-sizing:content-box;-webkit-box-sizing:content-box;",
			body = document.getElementsByTagName("body")[0];

		if ( !body ) {
			// Return for frameset docs that don't have a body
			return;
		}

		container = document.createElement("div");
		container.style.cssText = "border:0;width:0;height:0;position:absolute;top:0;left:-9999px;margin-top:1px";

		body.appendChild( container ).appendChild( div );

		// Support: IE8
		// Check if table cells still have offsetWidth/Height when they are set
		// to display:none and there are still other visible table cells in a
		// table row; if so, offsetWidth/Height are not reliable for use when
		// determining if an element has been hidden directly using
		// display:none (it is still safe to use offsets if a parent element is
		// hidden; don safety goggles and see bug #4512 for more information).
		div.innerHTML = "<table><tr><td></td><td>t</td></tr></table>";
		tds = div.getElementsByTagName("td");
		tds[ 0 ].style.cssText = "padding:0;margin:0;border:0;display:none";
		isSupported = ( tds[ 0 ].offsetHeight === 0 );

		tds[ 0 ].style.display = "";
		tds[ 1 ].style.display = "none";

		// Support: IE8
		// Check if empty table cells still have offsetWidth/Height
		support.reliableHiddenOffsets = isSupported && ( tds[ 0 ].offsetHeight === 0 );

		// Check box-sizing and margin behavior
		div.innerHTML = "";
		div.style.cssText = "box-sizing:border-box;-moz-box-sizing:border-box;-webkit-box-sizing:border-box;padding:1px;border:1px;display:block;width:4px;margin-top:1%;position:absolute;top:1%;";
		support.boxSizing = ( div.offsetWidth === 4 );
		support.doesNotIncludeMarginInBodyOffset = ( body.offsetTop !== 1 );

		// Use window.getComputedStyle because jsdom on node.js will break without it.
		if ( window.getComputedStyle ) {
			support.pixelPosition = ( window.getComputedStyle( div, null ) || {} ).top !== "1%";
			support.boxSizingReliable = ( window.getComputedStyle( div, null ) || { width: "4px" } ).width === "4px";

			// Check if div with explicit width and no margin-right incorrectly
			// gets computed margin-right based on width of container. (#3333)
			// Fails in WebKit before Feb 2011 nightlies
			// WebKit Bug 13343 - getComputedStyle returns wrong value for margin-right
			marginDiv = div.appendChild( document.createElement("div") );
			marginDiv.style.cssText = div.style.cssText = divReset;
			marginDiv.style.marginRight = marginDiv.style.width = "0";
			div.style.width = "1px";

			support.reliableMarginRight =
				!parseFloat( ( window.getComputedStyle( marginDiv, null ) || {} ).marginRight );
		}

		if ( typeof div.style.zoom !== core_strundefined ) {
			// Support: IE<8
			// Check if natively block-level elements act like inline-block
			// elements when setting their display to 'inline' and giving
			// them layout
			div.innerHTML = "";
			div.style.cssText = divReset + "width:1px;padding:1px;display:inline;zoom:1";
			support.inlineBlockNeedsLayout = ( div.offsetWidth === 3 );

			// Support: IE6
			// Check if elements with layout shrink-wrap their children
			div.style.display = "block";
			div.innerHTML = "<div></div>";
			div.firstChild.style.width = "5px";
			support.shrinkWrapBlocks = ( div.offsetWidth !== 3 );

			if ( support.inlineBlockNeedsLayout ) {
				// Prevent IE 6 from affecting layout for positioned elements #11048
				// Prevent IE from shrinking the body in IE 7 mode #12869
				// Support: IE<8
				body.style.zoom = 1;
			}
		}

		body.removeChild( container );

		// Null elements to avoid leaks in IE
		container = div = tds = marginDiv = null;
	});

	// Null elements to avoid leaks in IE
	all = select = fragment = opt = a = input = null;

	return support;
})();

var rbrace = /(?:\{[\s\S]*\}|\[[\s\S]*\])$/,
	rmultiDash = /([A-Z])/g;

function internalData( elem, name, data, pvt /* Internal Use Only */ ){
	if ( !jQuery.acceptData( elem ) ) {
		return;
	}

	var thisCache, ret,
		internalKey = jQuery.expando,
		getByName = typeof name === "string",

		// We have to handle DOM nodes and JS objects differently because IE6-7
		// can't GC object references properly across the DOM-JS boundary
		isNode = elem.nodeType,

		// Only DOM nodes need the global jQuery cache; JS object data is
		// attached directly to the object so GC can occur automatically
		cache = isNode ? jQuery.cache : elem,

		// Only defining an ID for JS objects if its cache already exists allows
		// the code to shortcut on the same path as a DOM node with no cache
		id = isNode ? elem[ internalKey ] : elem[ internalKey ] && internalKey;

	// Avoid doing any more work than we need to when trying to get data on an
	// object that has no data at all
	if ( (!id || !cache[id] || (!pvt && !cache[id].data)) && getByName && data === undefined ) {
		return;
	}

	if ( !id ) {
		// Only DOM nodes need a new unique ID for each element since their data
		// ends up in the global cache
		if ( isNode ) {
			elem[ internalKey ] = id = core_deletedIds.pop() || jQuery.guid++;
		} else {
			id = internalKey;
		}
	}

	if ( !cache[ id ] ) {
		cache[ id ] = {};

		// Avoids exposing jQuery metadata on plain JS objects when the object
		// is serialized using JSON.stringify
		if ( !isNode ) {
			cache[ id ].toJSON = jQuery.noop;
		}
	}

	// An object can be passed to jQuery.data instead of a key/value pair; this gets
	// shallow copied over onto the existing cache
	if ( typeof name === "object" || typeof name === "function" ) {
		if ( pvt ) {
			cache[ id ] = jQuery.extend( cache[ id ], name );
		} else {
			cache[ id ].data = jQuery.extend( cache[ id ].data, name );
		}
	}

	thisCache = cache[ id ];

	// jQuery data() is stored in a separate object inside the object's internal data
	// cache in order to avoid key collisions between internal data and user-defined
	// data.
	if ( !pvt ) {
		if ( !thisCache.data ) {
			thisCache.data = {};
		}

		thisCache = thisCache.data;
	}

	if ( data !== undefined ) {
		thisCache[ jQuery.camelCase( name ) ] = data;
	}

	// Check for both converted-to-camel and non-converted data property names
	// If a data property was specified
	if ( getByName ) {

		// First Try to find as-is property data
		ret = thisCache[ name ];

		// Test for null|undefined property data
		if ( ret == null ) {

			// Try to find the camelCased property
			ret = thisCache[ jQuery.camelCase( name ) ];
		}
	} else {
		ret = thisCache;
	}

	return ret;
}

function internalRemoveData( elem, name, pvt ) {
	if ( !jQuery.acceptData( elem ) ) {
		return;
	}

	var i, l, thisCache,
		isNode = elem.nodeType,

		// See jQuery.data for more information
		cache = isNode ? jQuery.cache : elem,
		id = isNode ? elem[ jQuery.expando ] : jQuery.expando;

	// If there is already no cache entry for this object, there is no
	// purpose in continuing
	if ( !cache[ id ] ) {
		return;
	}

	if ( name ) {

		thisCache = pvt ? cache[ id ] : cache[ id ].data;

		if ( thisCache ) {

			// Support array or space separated string names for data keys
			if ( !jQuery.isArray( name ) ) {

				// try the string as a key before any manipulation
				if ( name in thisCache ) {
					name = [ name ];
				} else {

					// split the camel cased version by spaces unless a key with the spaces exists
					name = jQuery.camelCase( name );
					if ( name in thisCache ) {
						name = [ name ];
					} else {
						name = name.split(" ");
					}
				}
			} else {
				// If "name" is an array of keys...
				// When data is initially created, via ("key", "val") signature,
				// keys will be converted to camelCase.
				// Since there is no way to tell _how_ a key was added, remove
				// both plain key and camelCase key. #12786
				// This will only penalize the array argument path.
				name = name.concat( jQuery.map( name, jQuery.camelCase ) );
			}

			for ( i = 0, l = name.length; i < l; i++ ) {
				delete thisCache[ name[i] ];
			}

			// If there is no data left in the cache, we want to continue
			// and let the cache object itself get destroyed
			if ( !( pvt ? isEmptyDataObject : jQuery.isEmptyObject )( thisCache ) ) {
				return;
			}
		}
	}

	// See jQuery.data for more information
	if ( !pvt ) {
		delete cache[ id ].data;

		// Don't destroy the parent cache unless the internal data object
		// had been the only thing left in it
		if ( !isEmptyDataObject( cache[ id ] ) ) {
			return;
		}
	}

	// Destroy the cache
	if ( isNode ) {
		jQuery.cleanData( [ elem ], true );

	// Use delete when supported for expandos or `cache` is not a window per isWindow (#10080)
	} else if ( jQuery.support.deleteExpando || cache != cache.window ) {
		delete cache[ id ];

	// When all else fails, null
	} else {
		cache[ id ] = null;
	}
}

jQuery.extend({
	cache: {},

	// Unique for each copy of jQuery on the page
	// Non-digits removed to match rinlinejQuery
	expando: "jQuery" + ( core_version + Math.random() ).replace( /\D/g, "" ),

	// The following elements throw uncatchable exceptions if you
	// attempt to add expando properties to them.
	noData: {
		"embed": true,
		// Ban all objects except for Flash (which handle expandos)
		"object": "clsid:D27CDB6E-AE6D-11cf-96B8-444553540000",
		"applet": true
	},

	hasData: function( elem ) {
		elem = elem.nodeType ? jQuery.cache[ elem[jQuery.expando] ] : elem[ jQuery.expando ];
		return !!elem && !isEmptyDataObject( elem );
	},

	data: function( elem, name, data ) {
		return internalData( elem, name, data );
	},

	removeData: function( elem, name ) {
		return internalRemoveData( elem, name );
	},

	// For internal use only.
	_data: function( elem, name, data ) {
		return internalData( elem, name, data, true );
	},

	_removeData: function( elem, name ) {
		return internalRemoveData( elem, name, true );
	},

	// A method for determining if a DOM node can handle the data expando
	acceptData: function( elem ) {
		// Do not set data on non-element because it will not be cleared (#8335).
		if ( elem.nodeType && elem.nodeType !== 1 && elem.nodeType !== 9 ) {
			return false;
		}

		var noData = elem.nodeName && jQuery.noData[ elem.nodeName.toLowerCase() ];

		// nodes accept data unless otherwise specified; rejection can be conditional
		return !noData || noData !== true && elem.getAttribute("classid") === noData;
	}
});

jQuery.fn.extend({
	data: function( key, value ) {
		var attrs, name,
			elem = this[0],
			i = 0,
			data = null;

		// Gets all values
		if ( key === undefined ) {
			if ( this.length ) {
				data = jQuery.data( elem );

				if ( elem.nodeType === 1 && !jQuery._data( elem, "parsedAttrs" ) ) {
					attrs = elem.attributes;
					for ( ; i < attrs.length; i++ ) {
						name = attrs[i].name;

						if ( !name.indexOf( "data-" ) ) {
							name = jQuery.camelCase( name.slice(5) );

							dataAttr( elem, name, data[ name ] );
						}
					}
					jQuery._data( elem, "parsedAttrs", true );
				}
			}

			return data;
		}

		// Sets multiple values
		if ( typeof key === "object" ) {
			return this.each(function() {
				jQuery.data( this, key );
			});
		}

		return jQuery.access( this, function( value ) {

			if ( value === undefined ) {
				// Try to fetch any internally stored data first
				return elem ? dataAttr( elem, key, jQuery.data( elem, key ) ) : null;
			}

			this.each(function() {
				jQuery.data( this, key, value );
			});
		}, null, value, arguments.length > 1, null, true );
	},

	removeData: function( key ) {
		return this.each(function() {
			jQuery.removeData( this, key );
		});
	}
});

function dataAttr( elem, key, data ) {
	// If nothing was found internally, try to fetch any
	// data from the HTML5 data-* attribute
	if ( data === undefined && elem.nodeType === 1 ) {

		var name = "data-" + key.replace( rmultiDash, "-$1" ).toLowerCase();

		data = elem.getAttribute( name );

		if ( typeof data === "string" ) {
			try {
				data = data === "true" ? true :
					data === "false" ? false :
					data === "null" ? null :
					// Only convert to a number if it doesn't change the string
					+data + "" === data ? +data :
					rbrace.test( data ) ? jQuery.parseJSON( data ) :
						data;
			} catch( e ) {}

			// Make sure we set the data so it isn't changed later
			jQuery.data( elem, key, data );

		} else {
			data = undefined;
		}
	}

	return data;
}

// checks a cache object for emptiness
function isEmptyDataObject( obj ) {
	var name;
	for ( name in obj ) {

		// if the public data object is empty, the private is still empty
		if ( name === "data" && jQuery.isEmptyObject( obj[name] ) ) {
			continue;
		}
		if ( name !== "toJSON" ) {
			return false;
		}
	}

	return true;
}
jQuery.extend({
	queue: function( elem, type, data ) {
		var queue;

		if ( elem ) {
			type = ( type || "fx" ) + "queue";
			queue = jQuery._data( elem, type );

			// Speed up dequeue by getting out quickly if this is just a lookup
			if ( data ) {
				if ( !queue || jQuery.isArray(data) ) {
					queue = jQuery._data( elem, type, jQuery.makeArray(data) );
				} else {
					queue.push( data );
				}
			}
			return queue || [];
		}
	},

	dequeue: function( elem, type ) {
		type = type || "fx";

		var queue = jQuery.queue( elem, type ),
			startLength = queue.length,
			fn = queue.shift(),
			hooks = jQuery._queueHooks( elem, type ),
			next = function() {
				jQuery.dequeue( elem, type );
			};

		// If the fx queue is dequeued, always remove the progress sentinel
		if ( fn === "inprogress" ) {
			fn = queue.shift();
			startLength--;
		}

		hooks.cur = fn;
		if ( fn ) {

			// Add a progress sentinel to prevent the fx queue from being
			// automatically dequeued
			if ( type === "fx" ) {
				queue.unshift( "inprogress" );
			}

			// clear up the last queue stop function
			delete hooks.stop;
			fn.call( elem, next, hooks );
		}

		if ( !startLength && hooks ) {
			hooks.empty.fire();
		}
	},

	// not intended for public consumption - generates a queueHooks object, or returns the current one
	_queueHooks: function( elem, type ) {
		var key = type + "queueHooks";
		return jQuery._data( elem, key ) || jQuery._data( elem, key, {
			empty: jQuery.Callbacks("once memory").add(function() {
				jQuery._removeData( elem, type + "queue" );
				jQuery._removeData( elem, key );
			})
		});
	}
});

jQuery.fn.extend({
	queue: function( type, data ) {
		var setter = 2;

		if ( typeof type !== "string" ) {
			data = type;
			type = "fx";
			setter--;
		}

		if ( arguments.length < setter ) {
			return jQuery.queue( this[0], type );
		}

		return data === undefined ?
			this :
			this.each(function() {
				var queue = jQuery.queue( this, type, data );

				// ensure a hooks for this queue
				jQuery._queueHooks( this, type );

				if ( type === "fx" && queue[0] !== "inprogress" ) {
					jQuery.dequeue( this, type );
				}
			});
	},
	dequeue: function( type ) {
		return this.each(function() {
			jQuery.dequeue( this, type );
		});
	},
	// Based off of the plugin by Clint Helfers, with permission.
	// http://blindsignals.com/index.php/2009/07/jquery-delay/
	delay: function( time, type ) {
		time = jQuery.fx ? jQuery.fx.speeds[ time ] || time : time;
		type = type || "fx";

		return this.queue( type, function( next, hooks ) {
			var timeout = setTimeout( next, time );
			hooks.stop = function() {
				clearTimeout( timeout );
			};
		});
	},
	clearQueue: function( type ) {
		return this.queue( type || "fx", [] );
	},
	// Get a promise resolved when queues of a certain type
	// are emptied (fx is the type by default)
	promise: function( type, obj ) {
		var tmp,
			count = 1,
			defer = jQuery.Deferred(),
			elements = this,
			i = this.length,
			resolve = function() {
				if ( !( --count ) ) {
					defer.resolveWith( elements, [ elements ] );
				}
			};

		if ( typeof type !== "string" ) {
			obj = type;
			type = undefined;
		}
		type = type || "fx";

		while( i-- ) {
			tmp = jQuery._data( elements[ i ], type + "queueHooks" );
			if ( tmp && tmp.empty ) {
				count++;
				tmp.empty.add( resolve );
			}
		}
		resolve();
		return defer.promise( obj );
	}
});
var nodeHook, boolHook,
	rclass = /[\t\r\n]/g,
	rreturn = /\r/g,
	rfocusable = /^(?:input|select|textarea|button|object)$/i,
	rclickable = /^(?:a|area)$/i,
	rboolean = /^(?:checked|selected|autofocus|autoplay|async|controls|defer|disabled|hidden|loop|multiple|open|readonly|required|scoped)$/i,
	ruseDefault = /^(?:checked|selected)$/i,
	getSetAttribute = jQuery.support.getSetAttribute,
	getSetInput = jQuery.support.input;

jQuery.fn.extend({
	attr: function( name, value ) {
		return jQuery.access( this, jQuery.attr, name, value, arguments.length > 1 );
	},

	removeAttr: function( name ) {
		return this.each(function() {
			jQuery.removeAttr( this, name );
		});
	},

	prop: function( name, value ) {
		return jQuery.access( this, jQuery.prop, name, value, arguments.length > 1 );
	},

	removeProp: function( name ) {
		name = jQuery.propFix[ name ] || name;
		return this.each(function() {
			// try/catch handles cases where IE balks (such as removing a property on window)
			try {
				this[ name ] = undefined;
				delete this[ name ];
			} catch( e ) {}
		});
	},

	addClass: function( value ) {
		var classes, elem, cur, clazz, j,
			i = 0,
			len = this.length,
			proceed = typeof value === "string" && value;

		if ( jQuery.isFunction( value ) ) {
			return this.each(function( j ) {
				jQuery( this ).addClass( value.call( this, j, this.className ) );
			});
		}

		if ( proceed ) {
			// The disjunction here is for better compressibility (see removeClass)
			classes = ( value || "" ).match( core_rnotwhite ) || [];

			for ( ; i < len; i++ ) {
				elem = this[ i ];
				cur = elem.nodeType === 1 && ( elem.className ?
					( " " + elem.className + " " ).replace( rclass, " " ) :
					" "
				);

				if ( cur ) {
					j = 0;
					while ( (clazz = classes[j++]) ) {
						if ( cur.indexOf( " " + clazz + " " ) < 0 ) {
							cur += clazz + " ";
						}
					}
					elem.className = jQuery.trim( cur );

				}
			}
		}

		return this;
	},

	removeClass: function( value ) {
		var classes, elem, cur, clazz, j,
			i = 0,
			len = this.length,
			proceed = arguments.length === 0 || typeof value === "string" && value;

		if ( jQuery.isFunction( value ) ) {
			return this.each(function( j ) {
				jQuery( this ).removeClass( value.call( this, j, this.className ) );
			});
		}
		if ( proceed ) {
			classes = ( value || "" ).match( core_rnotwhite ) || [];

			for ( ; i < len; i++ ) {
				elem = this[ i ];
				// This expression is here for better compressibility (see addClass)
				cur = elem.nodeType === 1 && ( elem.className ?
					( " " + elem.className + " " ).replace( rclass, " " ) :
					""
				);

				if ( cur ) {
					j = 0;
					while ( (clazz = classes[j++]) ) {
						// Remove *all* instances
						while ( cur.indexOf( " " + clazz + " " ) >= 0 ) {
							cur = cur.replace( " " + clazz + " ", " " );
						}
					}
					elem.className = value ? jQuery.trim( cur ) : "";
				}
			}
		}

		return this;
	},

	toggleClass: function( value, stateVal ) {
		var type = typeof value,
			isBool = typeof stateVal === "boolean";

		if ( jQuery.isFunction( value ) ) {
			return this.each(function( i ) {
				jQuery( this ).toggleClass( value.call(this, i, this.className, stateVal), stateVal );
			});
		}

		return this.each(function() {
			if ( type === "string" ) {
				// toggle individual class names
				var className,
					i = 0,
					self = jQuery( this ),
					state = stateVal,
					classNames = value.match( core_rnotwhite ) || [];

				while ( (className = classNames[ i++ ]) ) {
					// check each className given, space separated list
					state = isBool ? state : !self.hasClass( className );
					self[ state ? "addClass" : "removeClass" ]( className );
				}

			// Toggle whole class name
			} else if ( type === core_strundefined || type === "boolean" ) {
				if ( this.className ) {
					// store className if set
					jQuery._data( this, "__className__", this.className );
				}

				// If the element has a class name or if we're passed "false",
				// then remove the whole classname (if there was one, the above saved it).
				// Otherwise bring back whatever was previously saved (if anything),
				// falling back to the empty string if nothing was stored.
				this.className = this.className || value === false ? "" : jQuery._data( this, "__className__" ) || "";
			}
		});
	},

	hasClass: function( selector ) {
		var className = " " + selector + " ",
			i = 0,
			l = this.length;
		for ( ; i < l; i++ ) {
			if ( this[i].nodeType === 1 && (" " + this[i].className + " ").replace(rclass, " ").indexOf( className ) >= 0 ) {
				return true;
			}
		}

		return false;
	},

	val: function( value ) {
		var ret, hooks, isFunction,
			elem = this[0];

		if ( !arguments.length ) {
			if ( elem ) {
				hooks = jQuery.valHooks[ elem.type ] || jQuery.valHooks[ elem.nodeName.toLowerCase() ];

				if ( hooks && "get" in hooks && (ret = hooks.get( elem, "value" )) !== undefined ) {
					return ret;
				}

				ret = elem.value;

				return typeof ret === "string" ?
					// handle most common string cases
					ret.replace(rreturn, "") :
					// handle cases where value is null/undef or number
					ret == null ? "" : ret;
			}

			return;
		}

		isFunction = jQuery.isFunction( value );

		return this.each(function( i ) {
			var val,
				self = jQuery(this);

			if ( this.nodeType !== 1 ) {
				return;
			}

			if ( isFunction ) {
				val = value.call( this, i, self.val() );
			} else {
				val = value;
			}

			// Treat null/undefined as ""; convert numbers to string
			if ( val == null ) {
				val = "";
			} else if ( typeof val === "number" ) {
				val += "";
			} else if ( jQuery.isArray( val ) ) {
				val = jQuery.map(val, function ( value ) {
					return value == null ? "" : value + "";
				});
			}

			hooks = jQuery.valHooks[ this.type ] || jQuery.valHooks[ this.nodeName.toLowerCase() ];

			// If set returns undefined, fall back to normal setting
			if ( !hooks || !("set" in hooks) || hooks.set( this, val, "value" ) === undefined ) {
				this.value = val;
			}
		});
	}
});

jQuery.extend({
	valHooks: {
		option: {
			get: function( elem ) {
				// attributes.value is undefined in Blackberry 4.7 but
				// uses .value. See #6932
				var val = elem.attributes.value;
				return !val || val.specified ? elem.value : elem.text;
			}
		},
		select: {
			get: function( elem ) {
				var value, option,
					options = elem.options,
					index = elem.selectedIndex,
					one = elem.type === "select-one" || index < 0,
					values = one ? null : [],
					max = one ? index + 1 : options.length,
					i = index < 0 ?
						max :
						one ? index : 0;

				// Loop through all the selected options
				for ( ; i < max; i++ ) {
					option = options[ i ];

					// oldIE doesn't update selected after form reset (#2551)
					if ( ( option.selected || i === index ) &&
							// Don't return options that are disabled or in a disabled optgroup
							( jQuery.support.optDisabled ? !option.disabled : option.getAttribute("disabled") === null ) &&
							( !option.parentNode.disabled || !jQuery.nodeName( option.parentNode, "optgroup" ) ) ) {

						// Get the specific value for the option
						value = jQuery( option ).val();

						// We don't need an array for one selects
						if ( one ) {
							return value;
						}

						// Multi-Selects return an array
						values.push( value );
					}
				}

				return values;
			},

			set: function( elem, value ) {
				var values = jQuery.makeArray( value );

				jQuery(elem).find("option").each(function() {
					this.selected = jQuery.inArray( jQuery(this).val(), values ) >= 0;
				});

				if ( !values.length ) {
					elem.selectedIndex = -1;
				}
				return values;
			}
		}
	},

	attr: function( elem, name, value ) {
		var hooks, notxml, ret,
			nType = elem.nodeType;

		// don't get/set attributes on text, comment and attribute nodes
		if ( !elem || nType === 3 || nType === 8 || nType === 2 ) {
			return;
		}

		// Fallback to prop when attributes are not supported
		if ( typeof elem.getAttribute === core_strundefined ) {
			return jQuery.prop( elem, name, value );
		}

		notxml = nType !== 1 || !jQuery.isXMLDoc( elem );

		// All attributes are lowercase
		// Grab necessary hook if one is defined
		if ( notxml ) {
			name = name.toLowerCase();
			hooks = jQuery.attrHooks[ name ] || ( rboolean.test( name ) ? boolHook : nodeHook );
		}

		if ( value !== undefined ) {

			if ( value === null ) {
				jQuery.removeAttr( elem, name );

			} else if ( hooks && notxml && "set" in hooks && (ret = hooks.set( elem, value, name )) !== undefined ) {
				return ret;

			} else {
				elem.setAttribute( name, value + "" );
				return value;
			}

		} else if ( hooks && notxml && "get" in hooks && (ret = hooks.get( elem, name )) !== null ) {
			return ret;

		} else {

			// In IE9+, Flash objects don't have .getAttribute (#12945)
			// Support: IE9+
			if ( typeof elem.getAttribute !== core_strundefined ) {
				ret =  elem.getAttribute( name );
			}

			// Non-existent attributes return null, we normalize to undefined
			return ret == null ?
				undefined :
				ret;
		}
	},

	removeAttr: function( elem, value ) {
		var name, propName,
			i = 0,
			attrNames = value && value.match( core_rnotwhite );

		if ( attrNames && elem.nodeType === 1 ) {
			while ( (name = attrNames[i++]) ) {
				propName = jQuery.propFix[ name ] || name;

				// Boolean attributes get special treatment (#10870)
				if ( rboolean.test( name ) ) {
					// Set corresponding property to false for boolean attributes
					// Also clear defaultChecked/defaultSelected (if appropriate) for IE<8
					if ( !getSetAttribute && ruseDefault.test( name ) ) {
						elem[ jQuery.camelCase( "default-" + name ) ] =
							elem[ propName ] = false;
					} else {
						elem[ propName ] = false;
					}

				// See #9699 for explanation of this approach (setting first, then removal)
				} else {
					jQuery.attr( elem, name, "" );
				}

				elem.removeAttribute( getSetAttribute ? name : propName );
			}
		}
	},

	attrHooks: {
		type: {
			set: function( elem, value ) {
				if ( !jQuery.support.radioValue && value === "radio" && jQuery.nodeName(elem, "input") ) {
					// Setting the type on a radio button after the value resets the value in IE6-9
					// Reset value to default in case type is set after value during creation
					var val = elem.value;
					elem.setAttribute( "type", value );
					if ( val ) {
						elem.value = val;
					}
					return value;
				}
			}
		}
	},

	propFix: {
		tabindex: "tabIndex",
		readonly: "readOnly",
		"for": "htmlFor",
		"class": "className",
		maxlength: "maxLength",
		cellspacing: "cellSpacing",
		cellpadding: "cellPadding",
		rowspan: "rowSpan",
		colspan: "colSpan",
		usemap: "useMap",
		frameborder: "frameBorder",
		contenteditable: "contentEditable"
	},

	prop: function( elem, name, value ) {
		var ret, hooks, notxml,
			nType = elem.nodeType;

		// don't get/set properties on text, comment and attribute nodes
		if ( !elem || nType === 3 || nType === 8 || nType === 2 ) {
			return;
		}

		notxml = nType !== 1 || !jQuery.isXMLDoc( elem );

		if ( notxml ) {
			// Fix name and attach hooks
			name = jQuery.propFix[ name ] || name;
			hooks = jQuery.propHooks[ name ];
		}

		if ( value !== undefined ) {
			if ( hooks && "set" in hooks && (ret = hooks.set( elem, value, name )) !== undefined ) {
				return ret;

			} else {
				return ( elem[ name ] = value );
			}

		} else {
			if ( hooks && "get" in hooks && (ret = hooks.get( elem, name )) !== null ) {
				return ret;

			} else {
				return elem[ name ];
			}
		}
	},

	propHooks: {
		tabIndex: {
			get: function( elem ) {
				// elem.tabIndex doesn't always return the correct value when it hasn't been explicitly set
				// http://fluidproject.org/blog/2008/01/09/getting-setting-and-removing-tabindex-values-with-javascript/
				var attributeNode = elem.getAttributeNode("tabindex");

				return attributeNode && attributeNode.specified ?
					parseInt( attributeNode.value, 10 ) :
					rfocusable.test( elem.nodeName ) || rclickable.test( elem.nodeName ) && elem.href ?
						0 :
						undefined;
			}
		}
	}
});

// Hook for boolean attributes
boolHook = {
	get: function( elem, name ) {
		var
			// Use .prop to determine if this attribute is understood as boolean
			prop = jQuery.prop( elem, name ),

			// Fetch it accordingly
			attr = typeof prop === "boolean" && elem.getAttribute( name ),
			detail = typeof prop === "boolean" ?

				getSetInput && getSetAttribute ?
					attr != null :
					// oldIE fabricates an empty string for missing boolean attributes
					// and conflates checked/selected into attroperties
					ruseDefault.test( name ) ?
						elem[ jQuery.camelCase( "default-" + name ) ] :
						!!attr :

				// fetch an attribute node for properties not recognized as boolean
				elem.getAttributeNode( name );

		return detail && detail.value !== false ?
			name.toLowerCase() :
			undefined;
	},
	set: function( elem, value, name ) {
		if ( value === false ) {
			// Remove boolean attributes when set to false
			jQuery.removeAttr( elem, name );
		} else if ( getSetInput && getSetAttribute || !ruseDefault.test( name ) ) {
			// IE<8 needs the *property* name
			elem.setAttribute( !getSetAttribute && jQuery.propFix[ name ] || name, name );

		// Use defaultChecked and defaultSelected for oldIE
		} else {
			elem[ jQuery.camelCase( "default-" + name ) ] = elem[ name ] = true;
		}

		return name;
	}
};

// fix oldIE value attroperty
if ( !getSetInput || !getSetAttribute ) {
	jQuery.attrHooks.value = {
		get: function( elem, name ) {
			var ret = elem.getAttributeNode( name );
			return jQuery.nodeName( elem, "input" ) ?

				// Ignore the value *property* by using defaultValue
				elem.defaultValue :

				ret && ret.specified ? ret.value : undefined;
		},
		set: function( elem, value, name ) {
			if ( jQuery.nodeName( elem, "input" ) ) {
				// Does not return so that setAttribute is also used
				elem.defaultValue = value;
			} else {
				// Use nodeHook if defined (#1954); otherwise setAttribute is fine
				return nodeHook && nodeHook.set( elem, value, name );
			}
		}
	};
}

// IE6/7 do not support getting/setting some attributes with get/setAttribute
if ( !getSetAttribute ) {

	// Use this for any attribute in IE6/7
	// This fixes almost every IE6/7 issue
	nodeHook = jQuery.valHooks.button = {
		get: function( elem, name ) {
			var ret = elem.getAttributeNode( name );
			return ret && ( name === "id" || name === "name" || name === "coords" ? ret.value !== "" : ret.specified ) ?
				ret.value :
				undefined;
		},
		set: function( elem, value, name ) {
			// Set the existing or create a new attribute node
			var ret = elem.getAttributeNode( name );
			if ( !ret ) {
				elem.setAttributeNode(
					(ret = elem.ownerDocument.createAttribute( name ))
				);
			}

			ret.value = value += "";

			// Break association with cloned elements by also using setAttribute (#9646)
			return name === "value" || value === elem.getAttribute( name ) ?
				value :
				undefined;
		}
	};

	// Set contenteditable to false on removals(#10429)
	// Setting to empty string throws an error as an invalid value
	jQuery.attrHooks.contenteditable = {
		get: nodeHook.get,
		set: function( elem, value, name ) {
			nodeHook.set( elem, value === "" ? false : value, name );
		}
	};

	// Set width and height to auto instead of 0 on empty string( Bug #8150 )
	// This is for removals
	jQuery.each([ "width", "height" ], function( i, name ) {
		jQuery.attrHooks[ name ] = jQuery.extend( jQuery.attrHooks[ name ], {
			set: function( elem, value ) {
				if ( value === "" ) {
					elem.setAttribute( name, "auto" );
					return value;
				}
			}
		});
	});
}


// Some attributes require a special call on IE
// http://msdn.microsoft.com/en-us/library/ms536429%28VS.85%29.aspx
if ( !jQuery.support.hrefNormalized ) {
	jQuery.each([ "href", "src", "width", "height" ], function( i, name ) {
		jQuery.attrHooks[ name ] = jQuery.extend( jQuery.attrHooks[ name ], {
			get: function( elem ) {
				var ret = elem.getAttribute( name, 2 );
				return ret == null ? undefined : ret;
			}
		});
	});

	// href/src property should get the full normalized URL (#10299/#12915)
	jQuery.each([ "href", "src" ], function( i, name ) {
		jQuery.propHooks[ name ] = {
			get: function( elem ) {
				return elem.getAttribute( name, 4 );
			}
		};
	});
}

if ( !jQuery.support.style ) {
	jQuery.attrHooks.style = {
		get: function( elem ) {
			// Return undefined in the case of empty string
			// Note: IE uppercases css property names, but if we were to .toLowerCase()
			// .cssText, that would destroy case senstitivity in URL's, like in "background"
			return elem.style.cssText || undefined;
		},
		set: function( elem, value ) {
			return ( elem.style.cssText = value + "" );
		}
	};
}

// Safari mis-reports the default selected property of an option
// Accessing the parent's selectedIndex property fixes it
if ( !jQuery.support.optSelected ) {
	jQuery.propHooks.selected = jQuery.extend( jQuery.propHooks.selected, {
		get: function( elem ) {
			var parent = elem.parentNode;

			if ( parent ) {
				parent.selectedIndex;

				// Make sure that it also works with optgroups, see #5701
				if ( parent.parentNode ) {
					parent.parentNode.selectedIndex;
				}
			}
			return null;
		}
	});
}

// IE6/7 call enctype encoding
if ( !jQuery.support.enctype ) {
	jQuery.propFix.enctype = "encoding";
}

// Radios and checkboxes getter/setter
if ( !jQuery.support.checkOn ) {
	jQuery.each([ "radio", "checkbox" ], function() {
		jQuery.valHooks[ this ] = {
			get: function( elem ) {
				// Handle the case where in Webkit "" is returned instead of "on" if a value isn't specified
				return elem.getAttribute("value") === null ? "on" : elem.value;
			}
		};
	});
}
jQuery.each([ "radio", "checkbox" ], function() {
	jQuery.valHooks[ this ] = jQuery.extend( jQuery.valHooks[ this ], {
		set: function( elem, value ) {
			if ( jQuery.isArray( value ) ) {
				return ( elem.checked = jQuery.inArray( jQuery(elem).val(), value ) >= 0 );
			}
		}
	});
});
var rformElems = /^(?:input|select|textarea)$/i,
	rkeyEvent = /^key/,
	rmouseEvent = /^(?:mouse|contextmenu)|click/,
	rfocusMorph = /^(?:focusinfocus|focusoutblur)$/,
	rtypenamespace = /^([^.]*)(?:\.(.+)|)$/;

function returnTrue() {
	return true;
}

function returnFalse() {
	return false;
}

/*
 * Helper functions for managing events -- not part of the public interface.
 * Props to Dean Edwards' addEvent library for many of the ideas.
 */
jQuery.event = {

	global: {},

	add: function( elem, types, handler, data, selector ) {
		var tmp, events, t, handleObjIn,
			special, eventHandle, handleObj,
			handlers, type, namespaces, origType,
			elemData = jQuery._data( elem );

		// Don't attach events to noData or text/comment nodes (but allow plain objects)
		if ( !elemData ) {
			return;
		}

		// Caller can pass in an object of custom data in lieu of the handler
		if ( handler.handler ) {
			handleObjIn = handler;
			handler = handleObjIn.handler;
			selector = handleObjIn.selector;
		}

		// Make sure that the handler has a unique ID, used to find/remove it later
		if ( !handler.guid ) {
			handler.guid = jQuery.guid++;
		}

		// Init the element's event structure and main handler, if this is the first
		if ( !(events = elemData.events) ) {
			events = elemData.events = {};
		}
		if ( !(eventHandle = elemData.handle) ) {
			eventHandle = elemData.handle = function( e ) {
				// Discard the second event of a jQuery.event.trigger() and
				// when an event is called after a page has unloaded
				return typeof jQuery !== core_strundefined && (!e || jQuery.event.triggered !== e.type) ?
					jQuery.event.dispatch.apply( eventHandle.elem, arguments ) :
					undefined;
			};
			// Add elem as a property of the handle fn to prevent a memory leak with IE non-native events
			eventHandle.elem = elem;
		}

		// Handle multiple events separated by a space
		// jQuery(...).bind("mouseover mouseout", fn);
		types = ( types || "" ).match( core_rnotwhite ) || [""];
		t = types.length;
		while ( t-- ) {
			tmp = rtypenamespace.exec( types[t] ) || [];
			type = origType = tmp[1];
			namespaces = ( tmp[2] || "" ).split( "." ).sort();

			// If event changes its type, use the special event handlers for the changed type
			special = jQuery.event.special[ type ] || {};

			// If selector defined, determine special event api type, otherwise given type
			type = ( selector ? special.delegateType : special.bindType ) || type;

			// Update special based on newly reset type
			special = jQuery.event.special[ type ] || {};

			// handleObj is passed to all event handlers
			handleObj = jQuery.extend({
				type: type,
				origType: origType,
				data: data,
				handler: handler,
				guid: handler.guid,
				selector: selector,
				needsContext: selector && jQuery.expr.match.needsContext.test( selector ),
				namespace: namespaces.join(".")
			}, handleObjIn );

			// Init the event handler queue if we're the first
			if ( !(handlers = events[ type ]) ) {
				handlers = events[ type ] = [];
				handlers.delegateCount = 0;

				// Only use addEventListener/attachEvent if the special events handler returns false
				if ( !special.setup || special.setup.call( elem, data, namespaces, eventHandle ) === false ) {
					// Bind the global event handler to the element
					if ( elem.addEventListener ) {
						elem.addEventListener( type, eventHandle, false );

					} else if ( elem.attachEvent ) {
						elem.attachEvent( "on" + type, eventHandle );
					}
				}
			}

			if ( special.add ) {
				special.add.call( elem, handleObj );

				if ( !handleObj.handler.guid ) {
					handleObj.handler.guid = handler.guid;
				}
			}

			// Add to the element's handler list, delegates in front
			if ( selector ) {
				handlers.splice( handlers.delegateCount++, 0, handleObj );
			} else {
				handlers.push( handleObj );
			}

			// Keep track of which events have ever been used, for event optimization
			jQuery.event.global[ type ] = true;
		}

		// Nullify elem to prevent memory leaks in IE
		elem = null;
	},

	// Detach an event or set of events from an element
	remove: function( elem, types, handler, selector, mappedTypes ) {
		var j, handleObj, tmp,
			origCount, t, events,
			special, handlers, type,
			namespaces, origType,
			elemData = jQuery.hasData( elem ) && jQuery._data( elem );

		if ( !elemData || !(events = elemData.events) ) {
			return;
		}

		// Once for each type.namespace in types; type may be omitted
		types = ( types || "" ).match( core_rnotwhite ) || [""];
		t = types.length;
		while ( t-- ) {
			tmp = rtypenamespace.exec( types[t] ) || [];
			type = origType = tmp[1];
			namespaces = ( tmp[2] || "" ).split( "." ).sort();

			// Unbind all events (on this namespace, if provided) for the element
			if ( !type ) {
				for ( type in events ) {
					jQuery.event.remove( elem, type + types[ t ], handler, selector, true );
				}
				continue;
			}

			special = jQuery.event.special[ type ] || {};
			type = ( selector ? special.delegateType : special.bindType ) || type;
			handlers = events[ type ] || [];
			tmp = tmp[2] && new RegExp( "(^|\\.)" + namespaces.join("\\.(?:.*\\.|)") + "(\\.|$)" );

			// Remove matching events
			origCount = j = handlers.length;
			while ( j-- ) {
				handleObj = handlers[ j ];

				if ( ( mappedTypes || origType === handleObj.origType ) &&
					( !handler || handler.guid === handleObj.guid ) &&
					( !tmp || tmp.test( handleObj.namespace ) ) &&
					( !selector || selector === handleObj.selector || selector === "**" && handleObj.selector ) ) {
					handlers.splice( j, 1 );

					if ( handleObj.selector ) {
						handlers.delegateCount--;
					}
					if ( special.remove ) {
						special.remove.call( elem, handleObj );
					}
				}
			}

			// Remove generic event handler if we removed something and no more handlers exist
			// (avoids potential for endless recursion during removal of special event handlers)
			if ( origCount && !handlers.length ) {
				if ( !special.teardown || special.teardown.call( elem, namespaces, elemData.handle ) === false ) {
					jQuery.removeEvent( elem, type, elemData.handle );
				}

				delete events[ type ];
			}
		}

		// Remove the expando if it's no longer used
		if ( jQuery.isEmptyObject( events ) ) {
			delete elemData.handle;

			// removeData also checks for emptiness and clears the expando if empty
			// so use it instead of delete
			jQuery._removeData( elem, "events" );
		}
	},

	trigger: function( event, data, elem, onlyHandlers ) {
		var handle, ontype, cur,
			bubbleType, special, tmp, i,
			eventPath = [ elem || document ],
			type = core_hasOwn.call( event, "type" ) ? event.type : event,
			namespaces = core_hasOwn.call( event, "namespace" ) ? event.namespace.split(".") : [];

		cur = tmp = elem = elem || document;

		// Don't do events on text and comment nodes
		if ( elem.nodeType === 3 || elem.nodeType === 8 ) {
			return;
		}

		// focus/blur morphs to focusin/out; ensure we're not firing them right now
		if ( rfocusMorph.test( type + jQuery.event.triggered ) ) {
			return;
		}

		if ( type.indexOf(".") >= 0 ) {
			// Namespaced trigger; create a regexp to match event type in handle()
			namespaces = type.split(".");
			type = namespaces.shift();
			namespaces.sort();
		}
		ontype = type.indexOf(":") < 0 && "on" + type;

		// Caller can pass in a jQuery.Event object, Object, or just an event type string
		event = event[ jQuery.expando ] ?
			event :
			new jQuery.Event( type, typeof event === "object" && event );

		event.isTrigger = true;
		event.namespace = namespaces.join(".");
		event.namespace_re = event.namespace ?
			new RegExp( "(^|\\.)" + namespaces.join("\\.(?:.*\\.|)") + "(\\.|$)" ) :
			null;

		// Clean up the event in case it is being reused
		event.result = undefined;
		if ( !event.target ) {
			event.target = elem;
		}

		// Clone any incoming data and prepend the event, creating the handler arg list
		data = data == null ?
			[ event ] :
			jQuery.makeArray( data, [ event ] );

		// Allow special events to draw outside the lines
		special = jQuery.event.special[ type ] || {};
		if ( !onlyHandlers && special.trigger && special.trigger.apply( elem, data ) === false ) {
			return;
		}

		// Determine event propagation path in advance, per W3C events spec (#9951)
		// Bubble up to document, then to window; watch for a global ownerDocument var (#9724)
		if ( !onlyHandlers && !special.noBubble && !jQuery.isWindow( elem ) ) {

			bubbleType = special.delegateType || type;
			if ( !rfocusMorph.test( bubbleType + type ) ) {
				cur = cur.parentNode;
			}
			for ( ; cur; cur = cur.parentNode ) {
				eventPath.push( cur );
				tmp = cur;
			}

			// Only add window if we got to document (e.g., not plain obj or detached DOM)
			if ( tmp === (elem.ownerDocument || document) ) {
				eventPath.push( tmp.defaultView || tmp.parentWindow || window );
			}
		}

		// Fire handlers on the event path
		i = 0;
		while ( (cur = eventPath[i++]) && !event.isPropagationStopped() ) {

			event.type = i > 1 ?
				bubbleType :
				special.bindType || type;

			// jQuery handler
			handle = ( jQuery._data( cur, "events" ) || {} )[ event.type ] && jQuery._data( cur, "handle" );
			if ( handle ) {
				handle.apply( cur, data );
			}

			// Native handler
			handle = ontype && cur[ ontype ];
			if ( handle && jQuery.acceptData( cur ) && handle.apply && handle.apply( cur, data ) === false ) {
				event.preventDefault();
			}
		}
		event.type = type;

		// If nobody prevented the default action, do it now
		if ( !onlyHandlers && !event.isDefaultPrevented() ) {

			if ( (!special._default || special._default.apply( elem.ownerDocument, data ) === false) &&
				!(type === "click" && jQuery.nodeName( elem, "a" )) && jQuery.acceptData( elem ) ) {

				// Call a native DOM method on the target with the same name name as the event.
				// Can't use an .isFunction() check here because IE6/7 fails that test.
				// Don't do default actions on window, that's where global variables be (#6170)
				if ( ontype && elem[ type ] && !jQuery.isWindow( elem ) ) {

					// Don't re-trigger an onFOO event when we call its FOO() method
					tmp = elem[ ontype ];

					if ( tmp ) {
						elem[ ontype ] = null;
					}

					// Prevent re-triggering of the same event, since we already bubbled it above
					jQuery.event.triggered = type;
					try {
						elem[ type ]();
					} catch ( e ) {
						// IE<9 dies on focus/blur to hidden element (#1486,#12518)
						// only reproducible on winXP IE8 native, not IE9 in IE8 mode
					}
					jQuery.event.triggered = undefined;

					if ( tmp ) {
						elem[ ontype ] = tmp;
					}
				}
			}
		}

		return event.result;
	},

	dispatch: function( event ) {

		// Make a writable jQuery.Event from the native event object
		event = jQuery.event.fix( event );

		var i, ret, handleObj, matched, j,
			handlerQueue = [],
			args = core_slice.call( arguments ),
			handlers = ( jQuery._data( this, "events" ) || {} )[ event.type ] || [],
			special = jQuery.event.special[ event.type ] || {};

		// Use the fix-ed jQuery.Event rather than the (read-only) native event
		args[0] = event;
		event.delegateTarget = this;

		// Call the preDispatch hook for the mapped type, and let it bail if desired
		if ( special.preDispatch && special.preDispatch.call( this, event ) === false ) {
			return;
		}

		// Determine handlers
		handlerQueue = jQuery.event.handlers.call( this, event, handlers );

		// Run delegates first; they may want to stop propagation beneath us
		i = 0;
		while ( (matched = handlerQueue[ i++ ]) && !event.isPropagationStopped() ) {
			event.currentTarget = matched.elem;

			j = 0;
			while ( (handleObj = matched.handlers[ j++ ]) && !event.isImmediatePropagationStopped() ) {

				// Triggered event must either 1) have no namespace, or
				// 2) have namespace(s) a subset or equal to those in the bound event (both can have no namespace).
				if ( !event.namespace_re || event.namespace_re.test( handleObj.namespace ) ) {

					event.handleObj = handleObj;
					event.data = handleObj.data;

					ret = ( (jQuery.event.special[ handleObj.origType ] || {}).handle || handleObj.handler )
							.apply( matched.elem, args );

					if ( ret !== undefined ) {
						if ( (event.result = ret) === false ) {
							event.preventDefault();
							event.stopPropagation();
						}
					}
				}
			}
		}

		// Call the postDispatch hook for the mapped type
		if ( special.postDispatch ) {
			special.postDispatch.call( this, event );
		}

		return event.result;
	},

	handlers: function( event, handlers ) {
		var sel, handleObj, matches, i,
			handlerQueue = [],
			delegateCount = handlers.delegateCount,
			cur = event.target;

		// Find delegate handlers
		// Black-hole SVG <use> instance trees (#13180)
		// Avoid non-left-click bubbling in Firefox (#3861)
		if ( delegateCount && cur.nodeType && (!event.button || event.type !== "click") ) {

			for ( ; cur != this; cur = cur.parentNode || this ) {

				// Don't check non-elements (#13208)
				// Don't process clicks on disabled elements (#6911, #8165, #11382, #11764)
				if ( cur.nodeType === 1 && (cur.disabled !== true || event.type !== "click") ) {
					matches = [];
					for ( i = 0; i < delegateCount; i++ ) {
						handleObj = handlers[ i ];

						// Don't conflict with Object.prototype properties (#13203)
						sel = handleObj.selector + " ";

						if ( matches[ sel ] === undefined ) {
							matches[ sel ] = handleObj.needsContext ?
								jQuery( sel, this ).index( cur ) >= 0 :
								jQuery.find( sel, this, null, [ cur ] ).length;
						}
						if ( matches[ sel ] ) {
							matches.push( handleObj );
						}
					}
					if ( matches.length ) {
						handlerQueue.push({ elem: cur, handlers: matches });
					}
				}
			}
		}

		// Add the remaining (directly-bound) handlers
		if ( delegateCount < handlers.length ) {
			handlerQueue.push({ elem: this, handlers: handlers.slice( delegateCount ) });
		}

		return handlerQueue;
	},

	fix: function( event ) {
		if ( event[ jQuery.expando ] ) {
			return event;
		}

		// Create a writable copy of the event object and normalize some properties
		var i, prop, copy,
			type = event.type,
			originalEvent = event,
			fixHook = this.fixHooks[ type ];

		if ( !fixHook ) {
			this.fixHooks[ type ] = fixHook =
				rmouseEvent.test( type ) ? this.mouseHooks :
				rkeyEvent.test( type ) ? this.keyHooks :
				{};
		}
		copy = fixHook.props ? this.props.concat( fixHook.props ) : this.props;

		event = new jQuery.Event( originalEvent );

		i = copy.length;
		while ( i-- ) {
			prop = copy[ i ];
			event[ prop ] = originalEvent[ prop ];
		}

		// Support: IE<9
		// Fix target property (#1925)
		if ( !event.target ) {
			event.target = originalEvent.srcElement || document;
		}

		// Support: Chrome 23+, Safari?
		// Target should not be a text node (#504, #13143)
		if ( event.target.nodeType === 3 ) {
			event.target = event.target.parentNode;
		}

		// Support: IE<9
		// For mouse/key events, metaKey==false if it's undefined (#3368, #11328)
		event.metaKey = !!event.metaKey;

		return fixHook.filter ? fixHook.filter( event, originalEvent ) : event;
	},

	// Includes some event props shared by KeyEvent and MouseEvent
	props: "altKey bubbles cancelable ctrlKey currentTarget eventPhase metaKey relatedTarget shiftKey target timeStamp view which".split(" "),

	fixHooks: {},

	keyHooks: {
		props: "char charCode key keyCode".split(" "),
		filter: function( event, original ) {

			// Add which for key events
			if ( event.which == null ) {
				event.which = original.charCode != null ? original.charCode : original.keyCode;
			}

			return event;
		}
	},

	mouseHooks: {
		props: "button buttons clientX clientY fromElement offsetX offsetY pageX pageY screenX screenY toElement".split(" "),
		filter: function( event, original ) {
			var body, eventDoc, doc,
				button = original.button,
				fromElement = original.fromElement;

			// Calculate pageX/Y if missing and clientX/Y available
			if ( event.pageX == null && original.clientX != null ) {
				eventDoc = event.target.ownerDocument || document;
				doc = eventDoc.documentElement;
				body = eventDoc.body;

				event.pageX = original.clientX + ( doc && doc.scrollLeft || body && body.scrollLeft || 0 ) - ( doc && doc.clientLeft || body && body.clientLeft || 0 );
				event.pageY = original.clientY + ( doc && doc.scrollTop  || body && body.scrollTop  || 0 ) - ( doc && doc.clientTop  || body && body.clientTop  || 0 );
			}

			// Add relatedTarget, if necessary
			if ( !event.relatedTarget && fromElement ) {
				event.relatedTarget = fromElement === event.target ? original.toElement : fromElement;
			}

			// Add which for click: 1 === left; 2 === middle; 3 === right
			// Note: button is not normalized, so don't use it
			if ( !event.which && button !== undefined ) {
				event.which = ( button & 1 ? 1 : ( button & 2 ? 3 : ( button & 4 ? 2 : 0 ) ) );
			}

			return event;
		}
	},

	special: {
		load: {
			// Prevent triggered image.load events from bubbling to window.load
			noBubble: true
		},
		click: {
			// For checkbox, fire native event so checked state will be right
			trigger: function() {
				if ( jQuery.nodeName( this, "input" ) && this.type === "checkbox" && this.click ) {
					this.click();
					return false;
				}
			}
		},
		focus: {
			// Fire native event if possible so blur/focus sequence is correct
			trigger: function() {
				if ( this !== document.activeElement && this.focus ) {
					try {
						this.focus();
						return false;
					} catch ( e ) {
						// Support: IE<9
						// If we error on focus to hidden element (#1486, #12518),
						// let .trigger() run the handlers
					}
				}
			},
			delegateType: "focusin"
		},
		blur: {
			trigger: function() {
				if ( this === document.activeElement && this.blur ) {
					this.blur();
					return false;
				}
			},
			delegateType: "focusout"
		},

		beforeunload: {
			postDispatch: function( event ) {

				// Even when returnValue equals to undefined Firefox will still show alert
				if ( event.result !== undefined ) {
					event.originalEvent.returnValue = event.result;
				}
			}
		}
	},

	simulate: function( type, elem, event, bubble ) {
		// Piggyback on a donor event to simulate a different one.
		// Fake originalEvent to avoid donor's stopPropagation, but if the
		// simulated event prevents default then we do the same on the donor.
		var e = jQuery.extend(
			new jQuery.Event(),
			event,
			{ type: type,
				isSimulated: true,
				originalEvent: {}
			}
		);
		if ( bubble ) {
			jQuery.event.trigger( e, null, elem );
		} else {
			jQuery.event.dispatch.call( elem, e );
		}
		if ( e.isDefaultPrevented() ) {
			event.preventDefault();
		}
	}
};

jQuery.removeEvent = document.removeEventListener ?
	function( elem, type, handle ) {
		if ( elem.removeEventListener ) {
			elem.removeEventListener( type, handle, false );
		}
	} :
	function( elem, type, handle ) {
		var name = "on" + type;

		if ( elem.detachEvent ) {

			// #8545, #7054, preventing memory leaks for custom events in IE6-8
			// detachEvent needed property on element, by name of that event, to properly expose it to GC
			if ( typeof elem[ name ] === core_strundefined ) {
				elem[ name ] = null;
			}

			elem.detachEvent( name, handle );
		}
	};

jQuery.Event = function( src, props ) {
	// Allow instantiation without the 'new' keyword
	if ( !(this instanceof jQuery.Event) ) {
		return new jQuery.Event( src, props );
	}

	// Event object
	if ( src && src.type ) {
		this.originalEvent = src;
		this.type = src.type;

		// Events bubbling up the document may have been marked as prevented
		// by a handler lower down the tree; reflect the correct value.
		this.isDefaultPrevented = ( src.defaultPrevented || src.returnValue === false ||
			src.getPreventDefault && src.getPreventDefault() ) ? returnTrue : returnFalse;

	// Event type
	} else {
		this.type = src;
	}

	// Put explicitly provided properties onto the event object
	if ( props ) {
		jQuery.extend( this, props );
	}

	// Create a timestamp if incoming event doesn't have one
	this.timeStamp = src && src.timeStamp || jQuery.now();

	// Mark it as fixed
	this[ jQuery.expando ] = true;
};

// jQuery.Event is based on DOM3 Events as specified by the ECMAScript Language Binding
// http://www.w3.org/TR/2003/WD-DOM-Level-3-Events-20030331/ecma-script-binding.html
jQuery.Event.prototype = {
	isDefaultPrevented: returnFalse,
	isPropagationStopped: returnFalse,
	isImmediatePropagationStopped: returnFalse,

	preventDefault: function() {
		var e = this.originalEvent;

		this.isDefaultPrevented = returnTrue;
		if ( !e ) {
			return;
		}

		// If preventDefault exists, run it on the original event
		if ( e.preventDefault ) {
			e.preventDefault();

		// Support: IE
		// Otherwise set the returnValue property of the original event to false
		} else {
			e.returnValue = false;
		}
	},
	stopPropagation: function() {
		var e = this.originalEvent;

		this.isPropagationStopped = returnTrue;
		if ( !e ) {
			return;
		}
		// If stopPropagation exists, run it on the original event
		if ( e.stopPropagation ) {
			e.stopPropagation();
		}

		// Support: IE
		// Set the cancelBubble property of the original event to true
		e.cancelBubble = true;
	},
	stopImmediatePropagation: function() {
		this.isImmediatePropagationStopped = returnTrue;
		this.stopPropagation();
	}
};

// Create mouseenter/leave events using mouseover/out and event-time checks
jQuery.each({
	mouseenter: "mouseover",
	mouseleave: "mouseout"
}, function( orig, fix ) {
	jQuery.event.special[ orig ] = {
		delegateType: fix,
		bindType: fix,

		handle: function( event ) {
			var ret,
				target = this,
				related = event.relatedTarget,
				handleObj = event.handleObj;

			// For mousenter/leave call the handler if related is outside the target.
			// NB: No relatedTarget if the mouse left/entered the browser window
			if ( !related || (related !== target && !jQuery.contains( target, related )) ) {
				event.type = handleObj.origType;
				ret = handleObj.handler.apply( this, arguments );
				event.type = fix;
			}
			return ret;
		}
	};
});

// IE submit delegation
if ( !jQuery.support.submitBubbles ) {

	jQuery.event.special.submit = {
		setup: function() {
			// Only need this for delegated form submit events
			if ( jQuery.nodeName( this, "form" ) ) {
				return false;
			}

			// Lazy-add a submit handler when a descendant form may potentially be submitted
			jQuery.event.add( this, "click._submit keypress._submit", function( e ) {
				// Node name check avoids a VML-related crash in IE (#9807)
				var elem = e.target,
					form = jQuery.nodeName( elem, "input" ) || jQuery.nodeName( elem, "button" ) ? elem.form : undefined;
				if ( form && !jQuery._data( form, "submitBubbles" ) ) {
					jQuery.event.add( form, "submit._submit", function( event ) {
						event._submit_bubble = true;
					});
					jQuery._data( form, "submitBubbles", true );
				}
			});
			// return undefined since we don't need an event listener
		},

		postDispatch: function( event ) {
			// If form was submitted by the user, bubble the event up the tree
			if ( event._submit_bubble ) {
				delete event._submit_bubble;
				if ( this.parentNode && !event.isTrigger ) {
					jQuery.event.simulate( "submit", this.parentNode, event, true );
				}
			}
		},

		teardown: function() {
			// Only need this for delegated form submit events
			if ( jQuery.nodeName( this, "form" ) ) {
				return false;
			}

			// Remove delegated handlers; cleanData eventually reaps submit handlers attached above
			jQuery.event.remove( this, "._submit" );
		}
	};
}

// IE change delegation and checkbox/radio fix
if ( !jQuery.support.changeBubbles ) {

	jQuery.event.special.change = {

		setup: function() {

			if ( rformElems.test( this.nodeName ) ) {
				// IE doesn't fire change on a check/radio until blur; trigger it on click
				// after a propertychange. Eat the blur-change in special.change.handle.
				// This still fires onchange a second time for check/radio after blur.
				if ( this.type === "checkbox" || this.type === "radio" ) {
					jQuery.event.add( this, "propertychange._change", function( event ) {
						if ( event.originalEvent.propertyName === "checked" ) {
							this._just_changed = true;
						}
					});
					jQuery.event.add( this, "click._change", function( event ) {
						if ( this._just_changed && !event.isTrigger ) {
							this._just_changed = false;
						}
						// Allow triggered, simulated change events (#11500)
						jQuery.event.simulate( "change", this, event, true );
					});
				}
				return false;
			}
			// Delegated event; lazy-add a change handler on descendant inputs
			jQuery.event.add( this, "beforeactivate._change", function( e ) {
				var elem = e.target;

				if ( rformElems.test( elem.nodeName ) && !jQuery._data( elem, "changeBubbles" ) ) {
					jQuery.event.add( elem, "change._change", function( event ) {
						if ( this.parentNode && !event.isSimulated && !event.isTrigger ) {
							jQuery.event.simulate( "change", this.parentNode, event, true );
						}
					});
					jQuery._data( elem, "changeBubbles", true );
				}
			});
		},

		handle: function( event ) {
			var elem = event.target;

			// Swallow native change events from checkbox/radio, we already triggered them above
			if ( this !== elem || event.isSimulated || event.isTrigger || (elem.type !== "radio" && elem.type !== "checkbox") ) {
				return event.handleObj.handler.apply( this, arguments );
			}
		},

		teardown: function() {
			jQuery.event.remove( this, "._change" );

			return !rformElems.test( this.nodeName );
		}
	};
}

// Create "bubbling" focus and blur events
if ( !jQuery.support.focusinBubbles ) {
	jQuery.each({ focus: "focusin", blur: "focusout" }, function( orig, fix ) {

		// Attach a single capturing handler while someone wants focusin/focusout
		var attaches = 0,
			handler = function( event ) {
				jQuery.event.simulate( fix, event.target, jQuery.event.fix( event ), true );
			};

		jQuery.event.special[ fix ] = {
			setup: function() {
				if ( attaches++ === 0 ) {
					document.addEventListener( orig, handler, true );
				}
			},
			teardown: function() {
				if ( --attaches === 0 ) {
					document.removeEventListener( orig, handler, true );
				}
			}
		};
	});
}

jQuery.fn.extend({

	on: function( types, selector, data, fn, /*INTERNAL*/ one ) {
		var type, origFn;

		// Types can be a map of types/handlers
		if ( typeof types === "object" ) {
			// ( types-Object, selector, data )
			if ( typeof selector !== "string" ) {
				// ( types-Object, data )
				data = data || selector;
				selector = undefined;
			}
			for ( type in types ) {
				this.on( type, selector, data, types[ type ], one );
			}
			return this;
		}

		if ( data == null && fn == null ) {
			// ( types, fn )
			fn = selector;
			data = selector = undefined;
		} else if ( fn == null ) {
			if ( typeof selector === "string" ) {
				// ( types, selector, fn )
				fn = data;
				data = undefined;
			} else {
				// ( types, data, fn )
				fn = data;
				data = selector;
				selector = undefined;
			}
		}
		if ( fn === false ) {
			fn = returnFalse;
		} else if ( !fn ) {
			return this;
		}

		if ( one === 1 ) {
			origFn = fn;
			fn = function( event ) {
				// Can use an empty set, since event contains the info
				jQuery().off( event );
				return origFn.apply( this, arguments );
			};
			// Use same guid so caller can remove using origFn
			fn.guid = origFn.guid || ( origFn.guid = jQuery.guid++ );
		}
		return this.each( function() {
			jQuery.event.add( this, types, fn, data, selector );
		});
	},
	one: function( types, selector, data, fn ) {
		return this.on( types, selector, data, fn, 1 );
	},
	off: function( types, selector, fn ) {
		var handleObj, type;
		if ( types && types.preventDefault && types.handleObj ) {
			// ( event )  dispatched jQuery.Event
			handleObj = types.handleObj;
			jQuery( types.delegateTarget ).off(
				handleObj.namespace ? handleObj.origType + "." + handleObj.namespace : handleObj.origType,
				handleObj.selector,
				handleObj.handler
			);
			return this;
		}
		if ( typeof types === "object" ) {
			// ( types-object [, selector] )
			for ( type in types ) {
				this.off( type, selector, types[ type ] );
			}
			return this;
		}
		if ( selector === false || typeof selector === "function" ) {
			// ( types [, fn] )
			fn = selector;
			selector = undefined;
		}
		if ( fn === false ) {
			fn = returnFalse;
		}
		return this.each(function() {
			jQuery.event.remove( this, types, fn, selector );
		});
	},

	bind: function( types, data, fn ) {
		return this.on( types, null, data, fn );
	},
	unbind: function( types, fn ) {
		return this.off( types, null, fn );
	},

	delegate: function( selector, types, data, fn ) {
		return this.on( types, selector, data, fn );
	},
	undelegate: function( selector, types, fn ) {
		// ( namespace ) or ( selector, types [, fn] )
		return arguments.length === 1 ? this.off( selector, "**" ) : this.off( types, selector || "**", fn );
	},

	trigger: function( type, data ) {
		return this.each(function() {
			jQuery.event.trigger( type, data, this );
		});
	},
	triggerHandler: function( type, data ) {
		var elem = this[0];
		if ( elem ) {
			return jQuery.event.trigger( type, data, elem, true );
		}
	}
});
/*!
 * Sizzle CSS Selector Engine
 * Copyright 2012 jQuery Foundation and other contributors
 * Released under the MIT license
 * http://sizzlejs.com/
 */
(function( window, undefined ) {

var i,
	cachedruns,
	Expr,
	getText,
	isXML,
	compile,
	hasDuplicate,
	outermostContext,

	// Local document vars
	setDocument,
	document,
	docElem,
	documentIsXML,
	rbuggyQSA,
	rbuggyMatches,
	matches,
	contains,
	sortOrder,

	// Instance-specific data
	expando = "sizzle" + -(new Date()),
	preferredDoc = window.document,
	support = {},
	dirruns = 0,
	done = 0,
	classCache = createCache(),
	tokenCache = createCache(),
	compilerCache = createCache(),

	// General-purpose constants
	strundefined = typeof undefined,
	MAX_NEGATIVE = 1 << 31,

	// Array methods
	arr = [],
	pop = arr.pop,
	push = arr.push,
	slice = arr.slice,
	// Use a stripped-down indexOf if we can't use a native one
	indexOf = arr.indexOf || function( elem ) {
		var i = 0,
			len = this.length;
		for ( ; i < len; i++ ) {
			if ( this[i] === elem ) {
				return i;
			}
		}
		return -1;
	},


	// Regular expressions

	// Whitespace characters http://www.w3.org/TR/css3-selectors/#whitespace
	whitespace = "[\\x20\\t\\r\\n\\f]",
	// http://www.w3.org/TR/css3-syntax/#characters
	characterEncoding = "(?:\\\\.|[\\w-]|[^\\x00-\\xa0])+",

	// Loosely modeled on CSS identifier characters
	// An unquoted value should be a CSS identifier http://www.w3.org/TR/css3-selectors/#attribute-selectors
	// Proper syntax: http://www.w3.org/TR/CSS21/syndata.html#value-def-identifier
	identifier = characterEncoding.replace( "w", "w#" ),

	// Acceptable operators http://www.w3.org/TR/selectors/#attribute-selectors
	operators = "([*^$|!~]?=)",
	attributes = "\\[" + whitespace + "*(" + characterEncoding + ")" + whitespace +
		"*(?:" + operators + whitespace + "*(?:(['\"])((?:\\\\.|[^\\\\])*?)\\3|(" + identifier + ")|)|)" + whitespace + "*\\]",

	// Prefer arguments quoted,
	//   then not containing pseudos/brackets,
	//   then attribute selectors/non-parenthetical expressions,
	//   then anything else
	// These preferences are here to reduce the number of selectors
	//   needing tokenize in the PSEUDO preFilter
	pseudos = ":(" + characterEncoding + ")(?:\\(((['\"])((?:\\\\.|[^\\\\])*?)\\3|((?:\\\\.|[^\\\\()[\\]]|" + attributes.replace( 3, 8 ) + ")*)|.*)\\)|)",

	// Leading and non-escaped trailing whitespace, capturing some non-whitespace characters preceding the latter
	rtrim = new RegExp( "^" + whitespace + "+|((?:^|[^\\\\])(?:\\\\.)*)" + whitespace + "+$", "g" ),

	rcomma = new RegExp( "^" + whitespace + "*," + whitespace + "*" ),
	rcombinators = new RegExp( "^" + whitespace + "*([\\x20\\t\\r\\n\\f>+~])" + whitespace + "*" ),
	rpseudo = new RegExp( pseudos ),
	ridentifier = new RegExp( "^" + identifier + "$" ),

	matchExpr = {
		"ID": new RegExp( "^#(" + characterEncoding + ")" ),
		"CLASS": new RegExp( "^\\.(" + characterEncoding + ")" ),
		"NAME": new RegExp( "^\\[name=['\"]?(" + characterEncoding + ")['\"]?\\]" ),
		"TAG": new RegExp( "^(" + characterEncoding.replace( "w", "w*" ) + ")" ),
		"ATTR": new RegExp( "^" + attributes ),
		"PSEUDO": new RegExp( "^" + pseudos ),
		"CHILD": new RegExp( "^:(only|first|last|nth|nth-last)-(child|of-type)(?:\\(" + whitespace +
			"*(even|odd|(([+-]|)(\\d*)n|)" + whitespace + "*(?:([+-]|)" + whitespace +
			"*(\\d+)|))" + whitespace + "*\\)|)", "i" ),
		// For use in libraries implementing .is()
		// We use this for POS matching in `select`
		"needsContext": new RegExp( "^" + whitespace + "*[>+~]|:(even|odd|eq|gt|lt|nth|first|last)(?:\\(" +
			whitespace + "*((?:-\\d)?\\d*)" + whitespace + "*\\)|)(?=[^-]|$)", "i" )
	},

	rsibling = /[\x20\t\r\n\f]*[+~]/,

	rnative = /^[^{]+\{\s*\[native code/,

	// Easily-parseable/retrievable ID or TAG or CLASS selectors
	rquickExpr = /^(?:#([\w-]+)|(\w+)|\.([\w-]+))$/,

	rinputs = /^(?:input|select|textarea|button)$/i,
	rheader = /^h\d$/i,

	rescape = /'|\\/g,
	rattributeQuotes = /\=[\x20\t\r\n\f]*([^'"\]]*)[\x20\t\r\n\f]*\]/g,

	// CSS escapes http://www.w3.org/TR/CSS21/syndata.html#escaped-characters
	runescape = /\\([\da-fA-F]{1,6}[\x20\t\r\n\f]?|.)/g,
	funescape = function( _, escaped ) {
		var high = "0x" + escaped - 0x10000;
		// NaN means non-codepoint
		return high !== high ?
			escaped :
			// BMP codepoint
			high < 0 ?
				String.fromCharCode( high + 0x10000 ) :
				// Supplemental Plane codepoint (surrogate pair)
				String.fromCharCode( high >> 10 | 0xD800, high & 0x3FF | 0xDC00 );
	};

// Use a stripped-down slice if we can't use a native one
try {
	slice.call( preferredDoc.documentElement.childNodes, 0 )[0].nodeType;
} catch ( e ) {
	slice = function( i ) {
		var elem,
			results = [];
		while ( (elem = this[i++]) ) {
			results.push( elem );
		}
		return results;
	};
}

/**
 * For feature detection
 * @param {Function} fn The function to test for native support
 */
function isNative( fn ) {
	return rnative.test( fn + "" );
}

/**
 * Create key-value caches of limited size
 * @returns {Function(string, Object)} Returns the Object data after storing it on itself with
 *	property name the (space-suffixed) string and (if the cache is larger than Expr.cacheLength)
 *	deleting the oldest entry
 */
function createCache() {
	var cache,
		keys = [];

	return (cache = function( key, value ) {
		// Use (key + " ") to avoid collision with native prototype properties (see Issue #157)
		if ( keys.push( key += " " ) > Expr.cacheLength ) {
			// Only keep the most recent entries
			delete cache[ keys.shift() ];
		}
		return (cache[ key ] = value);
	});
}

/**
 * Mark a function for special use by Sizzle
 * @param {Function} fn The function to mark
 */
function markFunction( fn ) {
	fn[ expando ] = true;
	return fn;
}

/**
 * Support testing using an element
 * @param {Function} fn Passed the created div and expects a boolean result
 */
function assert( fn ) {
	var div = document.createElement("div");

	try {
		return fn( div );
	} catch (e) {
		return false;
	} finally {
		// release memory in IE
		div = null;
	}
}

function Sizzle( selector, context, results, seed ) {
	var match, elem, m, nodeType,
		// QSA vars
		i, groups, old, nid, newContext, newSelector;

	if ( ( context ? context.ownerDocument || context : preferredDoc ) !== document ) {
		setDocument( context );
	}

	context = context || document;
	results = results || [];

	if ( !selector || typeof selector !== "string" ) {
		return results;
	}

	if ( (nodeType = context.nodeType) !== 1 && nodeType !== 9 ) {
		return [];
	}

	if ( !documentIsXML && !seed ) {

		// Shortcuts
		if ( (match = rquickExpr.exec( selector )) ) {
			// Speed-up: Sizzle("#ID")
			if ( (m = match[1]) ) {
				if ( nodeType === 9 ) {
					elem = context.getElementById( m );
					// Check parentNode to catch when Blackberry 4.6 returns
					// nodes that are no longer in the document #6963
					if ( elem && elem.parentNode ) {
						// Handle the case where IE, Opera, and Webkit return items
						// by name instead of ID
						if ( elem.id === m ) {
							results.push( elem );
							return results;
						}
					} else {
						return results;
					}
				} else {
					// Context is not a document
					if ( context.ownerDocument && (elem = context.ownerDocument.getElementById( m )) &&
						contains( context, elem ) && elem.id === m ) {
						results.push( elem );
						return results;
					}
				}

			// Speed-up: Sizzle("TAG")
			} else if ( match[2] ) {
				push.apply( results, slice.call(context.getElementsByTagName( selector ), 0) );
				return results;

			// Speed-up: Sizzle(".CLASS")
			} else if ( (m = match[3]) && support.getByClassName && context.getElementsByClassName ) {
				push.apply( results, slice.call(context.getElementsByClassName( m ), 0) );
				return results;
			}
		}

		// QSA path
		if ( support.qsa && !rbuggyQSA.test(selector) ) {
			old = true;
			nid = expando;
			newContext = context;
			newSelector = nodeType === 9 && selector;

			// qSA works strangely on Element-rooted queries
			// We can work around this by specifying an extra ID on the root
			// and working up from there (Thanks to Andrew Dupont for the technique)
			// IE 8 doesn't work on object elements
			if ( nodeType === 1 && context.nodeName.toLowerCase() !== "object" ) {
				groups = tokenize( selector );

				if ( (old = context.getAttribute("id")) ) {
					nid = old.replace( rescape, "\\$&" );
				} else {
					context.setAttribute( "id", nid );
				}
				nid = "[id='" + nid + "'] ";

				i = groups.length;
				while ( i-- ) {
					groups[i] = nid + toSelector( groups[i] );
				}
				newContext = rsibling.test( selector ) && context.parentNode || context;
				newSelector = groups.join(",");
			}

			if ( newSelector ) {
				try {
					push.apply( results, slice.call( newContext.querySelectorAll(
						newSelector
					), 0 ) );
					return results;
				} catch(qsaError) {
				} finally {
					if ( !old ) {
						context.removeAttribute("id");
					}
				}
			}
		}
	}

	// All others
	return select( selector.replace( rtrim, "$1" ), context, results, seed );
}

/**
 * Detect xml
 * @param {Element|Object} elem An element or a document
 */
isXML = Sizzle.isXML = function( elem ) {
	// documentElement is verified for cases where it doesn't yet exist
	// (such as loading iframes in IE - #4833)
	var documentElement = elem && (elem.ownerDocument || elem).documentElement;
	return documentElement ? documentElement.nodeName !== "HTML" : false;
};

/**
 * Sets document-related variables once based on the current document
 * @param {Element|Object} [doc] An element or document object to use to set the document
 * @returns {Object} Returns the current document
 */
setDocument = Sizzle.setDocument = function( node ) {
	var doc = node ? node.ownerDocument || node : preferredDoc;

	// If no document and documentElement is available, return
	if ( doc === document || doc.nodeType !== 9 || !doc.documentElement ) {
		return document;
	}

	// Set our document
	document = doc;
	docElem = doc.documentElement;

	// Support tests
	documentIsXML = isXML( doc );

	// Check if getElementsByTagName("*") returns only elements
	support.tagNameNoComments = assert(function( div ) {
		div.appendChild( doc.createComment("") );
		return !div.getElementsByTagName("*").length;
	});

	// Check if attributes should be retrieved by attribute nodes
	support.attributes = assert(function( div ) {
		div.innerHTML = "<select></select>";
		var type = typeof div.lastChild.getAttribute("multiple");
		// IE8 returns a string for some attributes even when not present
		return type !== "boolean" && type !== "string";
	});

	// Check if getElementsByClassName can be trusted
	support.getByClassName = assert(function( div ) {
		// Opera can't find a second classname (in 9.6)
		div.innerHTML = "<div class='hidden e'></div><div class='hidden'></div>";
		if ( !div.getElementsByClassName || !div.getElementsByClassName("e").length ) {
			return false;
		}

		// Safari 3.2 caches class attributes and doesn't catch changes
		div.lastChild.className = "e";
		return div.getElementsByClassName("e").length === 2;
	});

	// Check if getElementById returns elements by name
	// Check if getElementsByName privileges form controls or returns elements by ID
	support.getByName = assert(function( div ) {
		// Inject content
		div.id = expando + 0;
		div.innerHTML = "<a name='" + expando + "'></a><div name='" + expando + "'></div>";
		docElem.insertBefore( div, docElem.firstChild );

		// Test
		var pass = doc.getElementsByName &&
			// buggy browsers will return fewer than the correct 2
			doc.getElementsByName( expando ).length === 2 +
			// buggy browsers will return more than the correct 0
			doc.getElementsByName( expando + 0 ).length;
		support.getIdNotName = !doc.getElementById( expando );

		// Cleanup
		docElem.removeChild( div );

		return pass;
	});

	// IE6/7 return modified attributes
	Expr.attrHandle = assert(function( div ) {
		div.innerHTML = "<a href='#'></a>";
		return div.firstChild && typeof div.firstChild.getAttribute !== strundefined &&
			div.firstChild.getAttribute("href") === "#";
	}) ?
		{} :
		{
			"href": function( elem ) {
				return elem.getAttribute( "href", 2 );
			},
			"type": function( elem ) {
				return elem.getAttribute("type");
			}
		};

	// ID find and filter
	if ( support.getIdNotName ) {
		Expr.find["ID"] = function( id, context ) {
			if ( typeof context.getElementById !== strundefined && !documentIsXML ) {
				var m = context.getElementById( id );
				// Check parentNode to catch when Blackberry 4.6 returns
				// nodes that are no longer in the document #6963
				return m && m.parentNode ? [m] : [];
			}
		};
		Expr.filter["ID"] = function( id ) {
			var attrId = id.replace( runescape, funescape );
			return function( elem ) {
				return elem.getAttribute("id") === attrId;
			};
		};
	} else {
		Expr.find["ID"] = function( id, context ) {
			if ( typeof context.getElementById !== strundefined && !documentIsXML ) {
				var m = context.getElementById( id );

				return m ?
					m.id === id || typeof m.getAttributeNode !== strundefined && m.getAttributeNode("id").value === id ?
						[m] :
						undefined :
					[];
			}
		};
		Expr.filter["ID"] =  function( id ) {
			var attrId = id.replace( runescape, funescape );
			return function( elem ) {
				var node = typeof elem.getAttributeNode !== strundefined && elem.getAttributeNode("id");
				return node && node.value === attrId;
			};
		};
	}

	// Tag
	Expr.find["TAG"] = support.tagNameNoComments ?
		function( tag, context ) {
			if ( typeof context.getElementsByTagName !== strundefined ) {
				return context.getElementsByTagName( tag );
			}
		} :
		function( tag, context ) {
			var elem,
				tmp = [],
				i = 0,
				results = context.getElementsByTagName( tag );

			// Filter out possible comments
			if ( tag === "*" ) {
				while ( (elem = results[i++]) ) {
					if ( elem.nodeType === 1 ) {
						tmp.push( elem );
					}
				}

				return tmp;
			}
			return results;
		};

	// Name
	Expr.find["NAME"] = support.getByName && function( tag, context ) {
		if ( typeof context.getElementsByName !== strundefined ) {
			return context.getElementsByName( name );
		}
	};

	// Class
	Expr.find["CLASS"] = support.getByClassName && function( className, context ) {
		if ( typeof context.getElementsByClassName !== strundefined && !documentIsXML ) {
			return context.getElementsByClassName( className );
		}
	};

	// QSA and matchesSelector support

	// matchesSelector(:active) reports false when true (IE9/Opera 11.5)
	rbuggyMatches = [];

	// qSa(:focus) reports false when true (Chrome 21),
	// no need to also add to buggyMatches since matches checks buggyQSA
	// A support test would require too much code (would include document ready)
	rbuggyQSA = [ ":focus" ];

	if ( (support.qsa = isNative(doc.querySelectorAll)) ) {
		// Build QSA regex
		// Regex strategy adopted from Diego Perini
		assert(function( div ) {
			// Select is set to empty string on purpose
			// This is to test IE's treatment of not explictly
			// setting a boolean content attribute,
			// since its presence should be enough
			// http://bugs.jquery.com/ticket/12359
			div.innerHTML = "<select><option selected=''></option></select>";

			// IE8 - Some boolean attributes are not treated correctly
			if ( !div.querySelectorAll("[selected]").length ) {
				rbuggyQSA.push( "\\[" + whitespace + "*(?:checked|disabled|ismap|multiple|readonly|selected|value)" );
			}

			// Webkit/Opera - :checked should return selected option elements
			// http://www.w3.org/TR/2011/REC-css3-selectors-20110929/#checked
			// IE8 throws error here and will not see later tests
			if ( !div.querySelectorAll(":checked").length ) {
				rbuggyQSA.push(":checked");
			}
		});

		assert(function( div ) {

			// Opera 10-12/IE8 - ^= $= *= and empty values
			// Should not select anything
			div.innerHTML = "<input type='hidden' i=''/>";
			if ( div.querySelectorAll("[i^='']").length ) {
				rbuggyQSA.push( "[*^$]=" + whitespace + "*(?:\"\"|'')" );
			}

			// FF 3.5 - :enabled/:disabled and hidden elements (hidden elements are still enabled)
			// IE8 throws error here and will not see later tests
			if ( !div.querySelectorAll(":enabled").length ) {
				rbuggyQSA.push( ":enabled", ":disabled" );
			}

			// Opera 10-11 does not throw on post-comma invalid pseudos
			div.querySelectorAll("*,:x");
			rbuggyQSA.push(",.*:");
		});
	}

	if ( (support.matchesSelector = isNative( (matches = docElem.matchesSelector ||
		docElem.mozMatchesSelector ||
		docElem.webkitMatchesSelector ||
		docElem.oMatchesSelector ||
		docElem.msMatchesSelector) )) ) {

		assert(function( div ) {
			// Check to see if it's possible to do matchesSelector
			// on a disconnected node (IE 9)
			support.disconnectedMatch = matches.call( div, "div" );

			// This should fail with an exception
			// Gecko does not error, returns false instead
			matches.call( div, "[s!='']:x" );
			rbuggyMatches.push( "!=", pseudos );
		});
	}

	rbuggyQSA = new RegExp( rbuggyQSA.join("|") );
	rbuggyMatches = new RegExp( rbuggyMatches.join("|") );

	// Element contains another
	// Purposefully does not implement inclusive descendent
	// As in, an element does not contain itself
	contains = isNative(docElem.contains) || docElem.compareDocumentPosition ?
		function( a, b ) {
			var adown = a.nodeType === 9 ? a.documentElement : a,
				bup = b && b.parentNode;
			return a === bup || !!( bup && bup.nodeType === 1 && (
				adown.contains ?
					adown.contains( bup ) :
					a.compareDocumentPosition && a.compareDocumentPosition( bup ) & 16
			));
		} :
		function( a, b ) {
			if ( b ) {
				while ( (b = b.parentNode) ) {
					if ( b === a ) {
						return true;
					}
				}
			}
			return false;
		};

	// Document order sorting
	sortOrder = docElem.compareDocumentPosition ?
	function( a, b ) {
		var compare;

		if ( a === b ) {
			hasDuplicate = true;
			return 0;
		}

		if ( (compare = b.compareDocumentPosition && a.compareDocumentPosition && a.compareDocumentPosition( b )) ) {
			if ( compare & 1 || a.parentNode && a.parentNode.nodeType === 11 ) {
				if ( a === doc || contains( preferredDoc, a ) ) {
					return -1;
				}
				if ( b === doc || contains( preferredDoc, b ) ) {
					return 1;
				}
				return 0;
			}
			return compare & 4 ? -1 : 1;
		}

		return a.compareDocumentPosition ? -1 : 1;
	} :
	function( a, b ) {
		var cur,
			i = 0,
			aup = a.parentNode,
			bup = b.parentNode,
			ap = [ a ],
			bp = [ b ];

		// Exit early if the nodes are identical
		if ( a === b ) {
			hasDuplicate = true;
			return 0;

		// Parentless nodes are either documents or disconnected
		} else if ( !aup || !bup ) {
			return a === doc ? -1 :
				b === doc ? 1 :
				aup ? -1 :
				bup ? 1 :
				0;

		// If the nodes are siblings, we can do a quick check
		} else if ( aup === bup ) {
			return siblingCheck( a, b );
		}

		// Otherwise we need full lists of their ancestors for comparison
		cur = a;
		while ( (cur = cur.parentNode) ) {
			ap.unshift( cur );
		}
		cur = b;
		while ( (cur = cur.parentNode) ) {
			bp.unshift( cur );
		}

		// Walk down the tree looking for a discrepancy
		while ( ap[i] === bp[i] ) {
			i++;
		}

		return i ?
			// Do a sibling check if the nodes have a common ancestor
			siblingCheck( ap[i], bp[i] ) :

			// Otherwise nodes in our document sort first
			ap[i] === preferredDoc ? -1 :
			bp[i] === preferredDoc ? 1 :
			0;
	};

	// Always assume the presence of duplicates if sort doesn't
	// pass them to our comparison function (as in Google Chrome).
	hasDuplicate = false;
	[0, 0].sort( sortOrder );
	support.detectDuplicates = hasDuplicate;

	return document;
};

Sizzle.matches = function( expr, elements ) {
	return Sizzle( expr, null, null, elements );
};

Sizzle.matchesSelector = function( elem, expr ) {
	// Set document vars if needed
	if ( ( elem.ownerDocument || elem ) !== document ) {
		setDocument( elem );
	}

	// Make sure that attribute selectors are quoted
	expr = expr.replace( rattributeQuotes, "='$1']" );

	// rbuggyQSA always contains :focus, so no need for an existence check
	if ( support.matchesSelector && !documentIsXML && (!rbuggyMatches || !rbuggyMatches.test(expr)) && !rbuggyQSA.test(expr) ) {
		try {
			var ret = matches.call( elem, expr );

			// IE 9's matchesSelector returns false on disconnected nodes
			if ( ret || support.disconnectedMatch ||
					// As well, disconnected nodes are said to be in a document
					// fragment in IE 9
					elem.document && elem.document.nodeType !== 11 ) {
				return ret;
			}
		} catch(e) {}
	}

	return Sizzle( expr, document, null, [elem] ).length > 0;
};

Sizzle.contains = function( context, elem ) {
	// Set document vars if needed
	if ( ( context.ownerDocument || context ) !== document ) {
		setDocument( context );
	}
	return contains( context, elem );
};

Sizzle.attr = function( elem, name ) {
	var val;

	// Set document vars if needed
	if ( ( elem.ownerDocument || elem ) !== document ) {
		setDocument( elem );
	}

	if ( !documentIsXML ) {
		name = name.toLowerCase();
	}
	if ( (val = Expr.attrHandle[ name ]) ) {
		return val( elem );
	}
	if ( documentIsXML || support.attributes ) {
		return elem.getAttribute( name );
	}
	return ( (val = elem.getAttributeNode( name )) || elem.getAttribute( name ) ) && elem[ name ] === true ?
		name :
		val && val.specified ? val.value : null;
};

Sizzle.error = function( msg ) {
	throw new Error( "Syntax error, unrecognized expression: " + msg );
};

// Document sorting and removing duplicates
Sizzle.uniqueSort = function( results ) {
	var elem,
		duplicates = [],
		i = 1,
		j = 0;

	// Unless we *know* we can detect duplicates, assume their presence
	hasDuplicate = !support.detectDuplicates;
	results.sort( sortOrder );

	if ( hasDuplicate ) {
		for ( ; (elem = results[i]); i++ ) {
			if ( elem === results[ i - 1 ] ) {
				j = duplicates.push( i );
			}
		}
		while ( j-- ) {
			results.splice( duplicates[ j ], 1 );
		}
	}

	return results;
};

function siblingCheck( a, b ) {
	var cur = b && a,
		diff = cur && ( ~b.sourceIndex || MAX_NEGATIVE ) - ( ~a.sourceIndex || MAX_NEGATIVE );

	// Use IE sourceIndex if available on both nodes
	if ( diff ) {
		return diff;
	}

	// Check if b follows a
	if ( cur ) {
		while ( (cur = cur.nextSibling) ) {
			if ( cur === b ) {
				return -1;
			}
		}
	}

	return a ? 1 : -1;
}

// Returns a function to use in pseudos for input types
function createInputPseudo( type ) {
	return function( elem ) {
		var name = elem.nodeName.toLowerCase();
		return name === "input" && elem.type === type;
	};
}

// Returns a function to use in pseudos for buttons
function createButtonPseudo( type ) {
	return function( elem ) {
		var name = elem.nodeName.toLowerCase();
		return (name === "input" || name === "button") && elem.type === type;
	};
}

// Returns a function to use in pseudos for positionals
function createPositionalPseudo( fn ) {
	return markFunction(function( argument ) {
		argument = +argument;
		return markFunction(function( seed, matches ) {
			var j,
				matchIndexes = fn( [], seed.length, argument ),
				i = matchIndexes.length;

			// Match elements found at the specified indexes
			while ( i-- ) {
				if ( seed[ (j = matchIndexes[i]) ] ) {
					seed[j] = !(matches[j] = seed[j]);
				}
			}
		});
	});
}

/**
 * Utility function for retrieving the text value of an array of DOM nodes
 * @param {Array|Element} elem
 */
getText = Sizzle.getText = function( elem ) {
	var node,
		ret = "",
		i = 0,
		nodeType = elem.nodeType;

	if ( !nodeType ) {
		// If no nodeType, this is expected to be an array
		for ( ; (node = elem[i]); i++ ) {
			// Do not traverse comment nodes
			ret += getText( node );
		}
	} else if ( nodeType === 1 || nodeType === 9 || nodeType === 11 ) {
		// Use textContent for elements
		// innerText usage removed for consistency of new lines (see #11153)
		if ( typeof elem.textContent === "string" ) {
			return elem.textContent;
		} else {
			// Traverse its children
			for ( elem = elem.firstChild; elem; elem = elem.nextSibling ) {
				ret += getText( elem );
			}
		}
	} else if ( nodeType === 3 || nodeType === 4 ) {
		return elem.nodeValue;
	}
	// Do not include comment or processing instruction nodes

	return ret;
};

Expr = Sizzle.selectors = {

	// Can be adjusted by the user
	cacheLength: 50,

	createPseudo: markFunction,

	match: matchExpr,

	find: {},

	relative: {
		">": { dir: "parentNode", first: true },
		" ": { dir: "parentNode" },
		"+": { dir: "previousSibling", first: true },
		"~": { dir: "previousSibling" }
	},

	preFilter: {
		"ATTR": function( match ) {
			match[1] = match[1].replace( runescape, funescape );

			// Move the given value to match[3] whether quoted or unquoted
			match[3] = ( match[4] || match[5] || "" ).replace( runescape, funescape );

			if ( match[2] === "~=" ) {
				match[3] = " " + match[3] + " ";
			}

			return match.slice( 0, 4 );
		},

		"CHILD": function( match ) {
			/* matches from matchExpr["CHILD"]
				1 type (only|nth|...)
				2 what (child|of-type)
				3 argument (even|odd|\d*|\d*n([+-]\d+)?|...)
				4 xn-component of xn+y argument ([+-]?\d*n|)
				5 sign of xn-component
				6 x of xn-component
				7 sign of y-component
				8 y of y-component
			*/
			match[1] = match[1].toLowerCase();

			if ( match[1].slice( 0, 3 ) === "nth" ) {
				// nth-* requires argument
				if ( !match[3] ) {
					Sizzle.error( match[0] );
				}

				// numeric x and y parameters for Expr.filter.CHILD
				// remember that false/true cast respectively to 0/1
				match[4] = +( match[4] ? match[5] + (match[6] || 1) : 2 * ( match[3] === "even" || match[3] === "odd" ) );
				match[5] = +( ( match[7] + match[8] ) || match[3] === "odd" );

			// other types prohibit arguments
			} else if ( match[3] ) {
				Sizzle.error( match[0] );
			}

			return match;
		},

		"PSEUDO": function( match ) {
			var excess,
				unquoted = !match[5] && match[2];

			if ( matchExpr["CHILD"].test( match[0] ) ) {
				return null;
			}

			// Accept quoted arguments as-is
			if ( match[4] ) {
				match[2] = match[4];

			// Strip excess characters from unquoted arguments
			} else if ( unquoted && rpseudo.test( unquoted ) &&
				// Get excess from tokenize (recursively)
				(excess = tokenize( unquoted, true )) &&
				// advance to the next closing parenthesis
				(excess = unquoted.indexOf( ")", unquoted.length - excess ) - unquoted.length) ) {

				// excess is a negative index
				match[0] = match[0].slice( 0, excess );
				match[2] = unquoted.slice( 0, excess );
			}

			// Return only captures needed by the pseudo filter method (type and argument)
			return match.slice( 0, 3 );
		}
	},

	filter: {

		"TAG": function( nodeName ) {
			if ( nodeName === "*" ) {
				return function() { return true; };
			}

			nodeName = nodeName.replace( runescape, funescape ).toLowerCase();
			return function( elem ) {
				return elem.nodeName && elem.nodeName.toLowerCase() === nodeName;
			};
		},

		"CLASS": function( className ) {
			var pattern = classCache[ className + " " ];

			return pattern ||
				(pattern = new RegExp( "(^|" + whitespace + ")" + className + "(" + whitespace + "|$)" )) &&
				classCache( className, function( elem ) {
					return pattern.test( elem.className || (typeof elem.getAttribute !== strundefined && elem.getAttribute("class")) || "" );
				});
		},

		"ATTR": function( name, operator, check ) {
			return function( elem ) {
				var result = Sizzle.attr( elem, name );

				if ( result == null ) {
					return operator === "!=";
				}
				if ( !operator ) {
					return true;
				}

				result += "";

				return operator === "=" ? result === check :
					operator === "!=" ? result !== check :
					operator === "^=" ? check && result.indexOf( check ) === 0 :
					operator === "*=" ? check && result.indexOf( check ) > -1 :
					operator === "$=" ? check && result.slice( -check.length ) === check :
					operator === "~=" ? ( " " + result + " " ).indexOf( check ) > -1 :
					operator === "|=" ? result === check || result.slice( 0, check.length + 1 ) === check + "-" :
					false;
			};
		},

		"CHILD": function( type, what, argument, first, last ) {
			var simple = type.slice( 0, 3 ) !== "nth",
				forward = type.slice( -4 ) !== "last",
				ofType = what === "of-type";

			return first === 1 && last === 0 ?

				// Shortcut for :nth-*(n)
				function( elem ) {
					return !!elem.parentNode;
				} :

				function( elem, context, xml ) {
					var cache, outerCache, node, diff, nodeIndex, start,
						dir = simple !== forward ? "nextSibling" : "previousSibling",
						parent = elem.parentNode,
						name = ofType && elem.nodeName.toLowerCase(),
						useCache = !xml && !ofType;

					if ( parent ) {

						// :(first|last|only)-(child|of-type)
						if ( simple ) {
							while ( dir ) {
								node = elem;
								while ( (node = node[ dir ]) ) {
									if ( ofType ? node.nodeName.toLowerCase() === name : node.nodeType === 1 ) {
										return false;
									}
								}
								// Reverse direction for :only-* (if we haven't yet done so)
								start = dir = type === "only" && !start && "nextSibling";
							}
							return true;
						}

						start = [ forward ? parent.firstChild : parent.lastChild ];

						// non-xml :nth-child(...) stores cache data on `parent`
						if ( forward && useCache ) {
							// Seek `elem` from a previously-cached index
							outerCache = parent[ expando ] || (parent[ expando ] = {});
							cache = outerCache[ type ] || [];
							nodeIndex = cache[0] === dirruns && cache[1];
							diff = cache[0] === dirruns && cache[2];
							node = nodeIndex && parent.childNodes[ nodeIndex ];

							while ( (node = ++nodeIndex && node && node[ dir ] ||

								// Fallback to seeking `elem` from the start
								(diff = nodeIndex = 0) || start.pop()) ) {

								// When found, cache indexes on `parent` and break
								if ( node.nodeType === 1 && ++diff && node === elem ) {
									outerCache[ type ] = [ dirruns, nodeIndex, diff ];
									break;
								}
							}

						// Use previously-cached element index if available
						} else if ( useCache && (cache = (elem[ expando ] || (elem[ expando ] = {}))[ type ]) && cache[0] === dirruns ) {
							diff = cache[1];

						// xml :nth-child(...) or :nth-last-child(...) or :nth(-last)?-of-type(...)
						} else {
							// Use the same loop as above to seek `elem` from the start
							while ( (node = ++nodeIndex && node && node[ dir ] ||
								(diff = nodeIndex = 0) || start.pop()) ) {

								if ( ( ofType ? node.nodeName.toLowerCase() === name : node.nodeType === 1 ) && ++diff ) {
									// Cache the index of each encountered element
									if ( useCache ) {
										(node[ expando ] || (node[ expando ] = {}))[ type ] = [ dirruns, diff ];
									}

									if ( node === elem ) {
										break;
									}
								}
							}
						}

						// Incorporate the offset, then check against cycle size
						diff -= last;
						return diff === first || ( diff % first === 0 && diff / first >= 0 );
					}
				};
		},

		"PSEUDO": function( pseudo, argument ) {
			// pseudo-class names are case-insensitive
			// http://www.w3.org/TR/selectors/#pseudo-classes
			// Prioritize by case sensitivity in case custom pseudos are added with uppercase letters
			// Remember that setFilters inherits from pseudos
			var args,
				fn = Expr.pseudos[ pseudo ] || Expr.setFilters[ pseudo.toLowerCase() ] ||
					Sizzle.error( "unsupported pseudo: " + pseudo );

			// The user may use createPseudo to indicate that
			// arguments are needed to create the filter function
			// just as Sizzle does
			if ( fn[ expando ] ) {
				return fn( argument );
			}

			// But maintain support for old signatures
			if ( fn.length > 1 ) {
				args = [ pseudo, pseudo, "", argument ];
				return Expr.setFilters.hasOwnProperty( pseudo.toLowerCase() ) ?
					markFunction(function( seed, matches ) {
						var idx,
							matched = fn( seed, argument ),
							i = matched.length;
						while ( i-- ) {
							idx = indexOf.call( seed, matched[i] );
							seed[ idx ] = !( matches[ idx ] = matched[i] );
						}
					}) :
					function( elem ) {
						return fn( elem, 0, args );
					};
			}

			return fn;
		}
	},

	pseudos: {
		// Potentially complex pseudos
		"not": markFunction(function( selector ) {
			// Trim the selector passed to compile
			// to avoid treating leading and trailing
			// spaces as combinators
			var input = [],
				results = [],
				matcher = compile( selector.replace( rtrim, "$1" ) );

			return matcher[ expando ] ?
				markFunction(function( seed, matches, context, xml ) {
					var elem,
						unmatched = matcher( seed, null, xml, [] ),
						i = seed.length;

					// Match elements unmatched by `matcher`
					while ( i-- ) {
						if ( (elem = unmatched[i]) ) {
							seed[i] = !(matches[i] = elem);
						}
					}
				}) :
				function( elem, context, xml ) {
					input[0] = elem;
					matcher( input, null, xml, results );
					return !results.pop();
				};
		}),

		"has": markFunction(function( selector ) {
			return function( elem ) {
				return Sizzle( selector, elem ).length > 0;
			};
		}),

		"contains": markFunction(function( text ) {
			return function( elem ) {
				return ( elem.textContent || elem.innerText || getText( elem ) ).indexOf( text ) > -1;
			};
		}),

		// "Whether an element is represented by a :lang() selector
		// is based solely on the element's language value
		// being equal to the identifier C,
		// or beginning with the identifier C immediately followed by "-".
		// The matching of C against the element's language value is performed case-insensitively.
		// The identifier C does not have to be a valid language name."
		// http://www.w3.org/TR/selectors/#lang-pseudo
		"lang": markFunction( function( lang ) {
			// lang value must be a valid identifider
			if ( !ridentifier.test(lang || "") ) {
				Sizzle.error( "unsupported lang: " + lang );
			}
			lang = lang.replace( runescape, funescape ).toLowerCase();
			return function( elem ) {
				var elemLang;
				do {
					if ( (elemLang = documentIsXML ?
						elem.getAttribute("xml:lang") || elem.getAttribute("lang") :
						elem.lang) ) {

						elemLang = elemLang.toLowerCase();
						return elemLang === lang || elemLang.indexOf( lang + "-" ) === 0;
					}
				} while ( (elem = elem.parentNode) && elem.nodeType === 1 );
				return false;
			};
		}),

		// Miscellaneous
		"target": function( elem ) {
			var hash = window.location && window.location.hash;
			return hash && hash.slice( 1 ) === elem.id;
		},

		"root": function( elem ) {
			return elem === docElem;
		},

		"focus": function( elem ) {
			return elem === document.activeElement && (!document.hasFocus || document.hasFocus()) && !!(elem.type || elem.href || ~elem.tabIndex);
		},

		// Boolean properties
		"enabled": function( elem ) {
			return elem.disabled === false;
		},

		"disabled": function( elem ) {
			return elem.disabled === true;
		},

		"checked": function( elem ) {
			// In CSS3, :checked should return both checked and selected elements
			// http://www.w3.org/TR/2011/REC-css3-selectors-20110929/#checked
			var nodeName = elem.nodeName.toLowerCase();
			return (nodeName === "input" && !!elem.checked) || (nodeName === "option" && !!elem.selected);
		},

		"selected": function( elem ) {
			// Accessing this property makes selected-by-default
			// options in Safari work properly
			if ( elem.parentNode ) {
				elem.parentNode.selectedIndex;
			}

			return elem.selected === true;
		},

		// Contents
		"empty": function( elem ) {
			// http://www.w3.org/TR/selectors/#empty-pseudo
			// :empty is only affected by element nodes and content nodes(including text(3), cdata(4)),
			//   not comment, processing instructions, or others
			// Thanks to Diego Perini for the nodeName shortcut
			//   Greater than "@" means alpha characters (specifically not starting with "#" or "?")
			for ( elem = elem.firstChild; elem; elem = elem.nextSibling ) {
				if ( elem.nodeName > "@" || elem.nodeType === 3 || elem.nodeType === 4 ) {
					return false;
				}
			}
			return true;
		},

		"parent": function( elem ) {
			return !Expr.pseudos["empty"]( elem );
		},

		// Element/input types
		"header": function( elem ) {
			return rheader.test( elem.nodeName );
		},

		"input": function( elem ) {
			return rinputs.test( elem.nodeName );
		},

		"button": function( elem ) {
			var name = elem.nodeName.toLowerCase();
			return name === "input" && elem.type === "button" || name === "button";
		},

		"text": function( elem ) {
			var attr;
			// IE6 and 7 will map elem.type to 'text' for new HTML5 types (search, etc)
			// use getAttribute instead to test this case
			return elem.nodeName.toLowerCase() === "input" &&
				elem.type === "text" &&
				( (attr = elem.getAttribute("type")) == null || attr.toLowerCase() === elem.type );
		},

		// Position-in-collection
		"first": createPositionalPseudo(function() {
			return [ 0 ];
		}),

		"last": createPositionalPseudo(function( matchIndexes, length ) {
			return [ length - 1 ];
		}),

		"eq": createPositionalPseudo(function( matchIndexes, length, argument ) {
			return [ argument < 0 ? argument + length : argument ];
		}),

		"even": createPositionalPseudo(function( matchIndexes, length ) {
			var i = 0;
			for ( ; i < length; i += 2 ) {
				matchIndexes.push( i );
			}
			return matchIndexes;
		}),

		"odd": createPositionalPseudo(function( matchIndexes, length ) {
			var i = 1;
			for ( ; i < length; i += 2 ) {
				matchIndexes.push( i );
			}
			return matchIndexes;
		}),

		"lt": createPositionalPseudo(function( matchIndexes, length, argument ) {
			var i = argument < 0 ? argument + length : argument;
			for ( ; --i >= 0; ) {
				matchIndexes.push( i );
			}
			return matchIndexes;
		}),

		"gt": createPositionalPseudo(function( matchIndexes, length, argument ) {
			var i = argument < 0 ? argument + length : argument;
			for ( ; ++i < length; ) {
				matchIndexes.push( i );
			}
			return matchIndexes;
		})
	}
};

// Add button/input type pseudos
for ( i in { radio: true, checkbox: true, file: true, password: true, image: true } ) {
	Expr.pseudos[ i ] = createInputPseudo( i );
}
for ( i in { submit: true, reset: true } ) {
	Expr.pseudos[ i ] = createButtonPseudo( i );
}

function tokenize( selector, parseOnly ) {
	var matched, match, tokens, type,
		soFar, groups, preFilters,
		cached = tokenCache[ selector + " " ];

	if ( cached ) {
		return parseOnly ? 0 : cached.slice( 0 );
	}

	soFar = selector;
	groups = [];
	preFilters = Expr.preFilter;

	while ( soFar ) {

		// Comma and first run
		if ( !matched || (match = rcomma.exec( soFar )) ) {
			if ( match ) {
				// Don't consume trailing commas as valid
				soFar = soFar.slice( match[0].length ) || soFar;
			}
			groups.push( tokens = [] );
		}

		matched = false;

		// Combinators
		if ( (match = rcombinators.exec( soFar )) ) {
			matched = match.shift();
			tokens.push( {
				value: matched,
				// Cast descendant combinators to space
				type: match[0].replace( rtrim, " " )
			} );
			soFar = soFar.slice( matched.length );
		}

		// Filters
		for ( type in Expr.filter ) {
			if ( (match = matchExpr[ type ].exec( soFar )) && (!preFilters[ type ] ||
				(match = preFilters[ type ]( match ))) ) {
				matched = match.shift();
				tokens.push( {
					value: matched,
					type: type,
					matches: match
				} );
				soFar = soFar.slice( matched.length );
			}
		}

		if ( !matched ) {
			break;
		}
	}

	// Return the length of the invalid excess
	// if we're just parsing
	// Otherwise, throw an error or return tokens
	return parseOnly ?
		soFar.length :
		soFar ?
			Sizzle.error( selector ) :
			// Cache the tokens
			tokenCache( selector, groups ).slice( 0 );
}

function toSelector( tokens ) {
	var i = 0,
		len = tokens.length,
		selector = "";
	for ( ; i < len; i++ ) {
		selector += tokens[i].value;
	}
	return selector;
}

function addCombinator( matcher, combinator, base ) {
	var dir = combinator.dir,
		checkNonElements = base && dir === "parentNode",
		doneName = done++;

	return combinator.first ?
		// Check against closest ancestor/preceding element
		function( elem, context, xml ) {
			while ( (elem = elem[ dir ]) ) {
				if ( elem.nodeType === 1 || checkNonElements ) {
					return matcher( elem, context, xml );
				}
			}
		} :

		// Check against all ancestor/preceding elements
		function( elem, context, xml ) {
			var data, cache, outerCache,
				dirkey = dirruns + " " + doneName;

			// We can't set arbitrary data on XML nodes, so they don't benefit from dir caching
			if ( xml ) {
				while ( (elem = elem[ dir ]) ) {
					if ( elem.nodeType === 1 || checkNonElements ) {
						if ( matcher( elem, context, xml ) ) {
							return true;
						}
					}
				}
			} else {
				while ( (elem = elem[ dir ]) ) {
					if ( elem.nodeType === 1 || checkNonElements ) {
						outerCache = elem[ expando ] || (elem[ expando ] = {});
						if ( (cache = outerCache[ dir ]) && cache[0] === dirkey ) {
							if ( (data = cache[1]) === true || data === cachedruns ) {
								return data === true;
							}
						} else {
							cache = outerCache[ dir ] = [ dirkey ];
							cache[1] = matcher( elem, context, xml ) || cachedruns;
							if ( cache[1] === true ) {
								return true;
							}
						}
					}
				}
			}
		};
}

function elementMatcher( matchers ) {
	return matchers.length > 1 ?
		function( elem, context, xml ) {
			var i = matchers.length;
			while ( i-- ) {
				if ( !matchers[i]( elem, context, xml ) ) {
					return false;
				}
			}
			return true;
		} :
		matchers[0];
}

function condense( unmatched, map, filter, context, xml ) {
	var elem,
		newUnmatched = [],
		i = 0,
		len = unmatched.length,
		mapped = map != null;

	for ( ; i < len; i++ ) {
		if ( (elem = unmatched[i]) ) {
			if ( !filter || filter( elem, context, xml ) ) {
				newUnmatched.push( elem );
				if ( mapped ) {
					map.push( i );
				}
			}
		}
	}

	return newUnmatched;
}

function setMatcher( preFilter, selector, matcher, postFilter, postFinder, postSelector ) {
	if ( postFilter && !postFilter[ expando ] ) {
		postFilter = setMatcher( postFilter );
	}
	if ( postFinder && !postFinder[ expando ] ) {
		postFinder = setMatcher( postFinder, postSelector );
	}
	return markFunction(function( seed, results, context, xml ) {
		var temp, i, elem,
			preMap = [],
			postMap = [],
			preexisting = results.length,

			// Get initial elements from seed or context
			elems = seed || multipleContexts( selector || "*", context.nodeType ? [ context ] : context, [] ),

			// Prefilter to get matcher input, preserving a map for seed-results synchronization
			matcherIn = preFilter && ( seed || !selector ) ?
				condense( elems, preMap, preFilter, context, xml ) :
				elems,

			matcherOut = matcher ?
				// If we have a postFinder, or filtered seed, or non-seed postFilter or preexisting results,
				postFinder || ( seed ? preFilter : preexisting || postFilter ) ?

					// ...intermediate processing is necessary
					[] :

					// ...otherwise use results directly
					results :
				matcherIn;

		// Find primary matches
		if ( matcher ) {
			matcher( matcherIn, matcherOut, context, xml );
		}

		// Apply postFilter
		if ( postFilter ) {
			temp = condense( matcherOut, postMap );
			postFilter( temp, [], context, xml );

			// Un-match failing elements by moving them back to matcherIn
			i = temp.length;
			while ( i-- ) {
				if ( (elem = temp[i]) ) {
					matcherOut[ postMap[i] ] = !(matcherIn[ postMap[i] ] = elem);
				}
			}
		}

		if ( seed ) {
			if ( postFinder || preFilter ) {
				if ( postFinder ) {
					// Get the final matcherOut by condensing this intermediate into postFinder contexts
					temp = [];
					i = matcherOut.length;
					while ( i-- ) {
						if ( (elem = matcherOut[i]) ) {
							// Restore matcherIn since elem is not yet a final match
							temp.push( (matcherIn[i] = elem) );
						}
					}
					postFinder( null, (matcherOut = []), temp, xml );
				}

				// Move matched elements from seed to results to keep them synchronized
				i = matcherOut.length;
				while ( i-- ) {
					if ( (elem = matcherOut[i]) &&
						(temp = postFinder ? indexOf.call( seed, elem ) : preMap[i]) > -1 ) {

						seed[temp] = !(results[temp] = elem);
					}
				}
			}

		// Add elements to results, through postFinder if defined
		} else {
			matcherOut = condense(
				matcherOut === results ?
					matcherOut.splice( preexisting, matcherOut.length ) :
					matcherOut
			);
			if ( postFinder ) {
				postFinder( null, results, matcherOut, xml );
			} else {
				push.apply( results, matcherOut );
			}
		}
	});
}

function matcherFromTokens( tokens ) {
	var checkContext, matcher, j,
		len = tokens.length,
		leadingRelative = Expr.relative[ tokens[0].type ],
		implicitRelative = leadingRelative || Expr.relative[" "],
		i = leadingRelative ? 1 : 0,

		// The foundational matcher ensures that elements are reachable from top-level context(s)
		matchContext = addCombinator( function( elem ) {
			return elem === checkContext;
		}, implicitRelative, true ),
		matchAnyContext = addCombinator( function( elem ) {
			return indexOf.call( checkContext, elem ) > -1;
		}, implicitRelative, true ),
		matchers = [ function( elem, context, xml ) {
			return ( !leadingRelative && ( xml || context !== outermostContext ) ) || (
				(checkContext = context).nodeType ?
					matchContext( elem, context, xml ) :
					matchAnyContext( elem, context, xml ) );
		} ];

	for ( ; i < len; i++ ) {
		if ( (matcher = Expr.relative[ tokens[i].type ]) ) {
			matchers = [ addCombinator(elementMatcher( matchers ), matcher) ];
		} else {
			matcher = Expr.filter[ tokens[i].type ].apply( null, tokens[i].matches );

			// Return special upon seeing a positional matcher
			if ( matcher[ expando ] ) {
				// Find the next relative operator (if any) for proper handling
				j = ++i;
				for ( ; j < len; j++ ) {
					if ( Expr.relative[ tokens[j].type ] ) {
						break;
					}
				}
				return setMatcher(
					i > 1 && elementMatcher( matchers ),
					i > 1 && toSelector( tokens.slice( 0, i - 1 ) ).replace( rtrim, "$1" ),
					matcher,
					i < j && matcherFromTokens( tokens.slice( i, j ) ),
					j < len && matcherFromTokens( (tokens = tokens.slice( j )) ),
					j < len && toSelector( tokens )
				);
			}
			matchers.push( matcher );
		}
	}

	return elementMatcher( matchers );
}

function matcherFromGroupMatchers( elementMatchers, setMatchers ) {
	// A counter to specify which element is currently being matched
	var matcherCachedRuns = 0,
		bySet = setMatchers.length > 0,
		byElement = elementMatchers.length > 0,
		superMatcher = function( seed, context, xml, results, expandContext ) {
			var elem, j, matcher,
				setMatched = [],
				matchedCount = 0,
				i = "0",
				unmatched = seed && [],
				outermost = expandContext != null,
				contextBackup = outermostContext,
				// We must always have either seed elements or context
				elems = seed || byElement && Expr.find["TAG"]( "*", expandContext && context.parentNode || context ),
				// Use integer dirruns iff this is the outermost matcher
				dirrunsUnique = (dirruns += contextBackup == null ? 1 : Math.random() || 0.1);

			if ( outermost ) {
				outermostContext = context !== document && context;
				cachedruns = matcherCachedRuns;
			}

			// Add elements passing elementMatchers directly to results
			// Keep `i` a string if there are no elements so `matchedCount` will be "00" below
			for ( ; (elem = elems[i]) != null; i++ ) {
				if ( byElement && elem ) {
					j = 0;
					while ( (matcher = elementMatchers[j++]) ) {
						if ( matcher( elem, context, xml ) ) {
							results.push( elem );
							break;
						}
					}
					if ( outermost ) {
						dirruns = dirrunsUnique;
						cachedruns = ++matcherCachedRuns;
					}
				}

				// Track unmatched elements for set filters
				if ( bySet ) {
					// They will have gone through all possible matchers
					if ( (elem = !matcher && elem) ) {
						matchedCount--;
					}

					// Lengthen the array for every element, matched or not
					if ( seed ) {
						unmatched.push( elem );
					}
				}
			}

			// Apply set filters to unmatched elements
			matchedCount += i;
			if ( bySet && i !== matchedCount ) {
				j = 0;
				while ( (matcher = setMatchers[j++]) ) {
					matcher( unmatched, setMatched, context, xml );
				}

				if ( seed ) {
					// Reintegrate element matches to eliminate the need for sorting
					if ( matchedCount > 0 ) {
						while ( i-- ) {
							if ( !(unmatched[i] || setMatched[i]) ) {
								setMatched[i] = pop.call( results );
							}
						}
					}

					// Discard index placeholder values to get only actual matches
					setMatched = condense( setMatched );
				}

				// Add matches to results
				push.apply( results, setMatched );

				// Seedless set matches succeeding multiple successful matchers stipulate sorting
				if ( outermost && !seed && setMatched.length > 0 &&
					( matchedCount + setMatchers.length ) > 1 ) {

					Sizzle.uniqueSort( results );
				}
			}

			// Override manipulation of globals by nested matchers
			if ( outermost ) {
				dirruns = dirrunsUnique;
				outermostContext = contextBackup;
			}

			return unmatched;
		};

	return bySet ?
		markFunction( superMatcher ) :
		superMatcher;
}

compile = Sizzle.compile = function( selector, group /* Internal Use Only */ ) {
	var i,
		setMatchers = [],
		elementMatchers = [],
		cached = compilerCache[ selector + " " ];

	if ( !cached ) {
		// Generate a function of recursive functions that can be used to check each element
		if ( !group ) {
			group = tokenize( selector );
		}
		i = group.length;
		while ( i-- ) {
			cached = matcherFromTokens( group[i] );
			if ( cached[ expando ] ) {
				setMatchers.push( cached );
			} else {
				elementMatchers.push( cached );
			}
		}

		// Cache the compiled function
		cached = compilerCache( selector, matcherFromGroupMatchers( elementMatchers, setMatchers ) );
	}
	return cached;
};

function multipleContexts( selector, contexts, results ) {
	var i = 0,
		len = contexts.length;
	for ( ; i < len; i++ ) {
		Sizzle( selector, contexts[i], results );
	}
	return results;
}

function select( selector, context, results, seed ) {
	var i, tokens, token, type, find,
		match = tokenize( selector );

	if ( !seed ) {
		// Try to minimize operations if there is only one group
		if ( match.length === 1 ) {

			// Take a shortcut and set the context if the root selector is an ID
			tokens = match[0] = match[0].slice( 0 );
			if ( tokens.length > 2 && (token = tokens[0]).type === "ID" &&
					context.nodeType === 9 && !documentIsXML &&
					Expr.relative[ tokens[1].type ] ) {

				context = Expr.find["ID"]( token.matches[0].replace( runescape, funescape ), context )[0];
				if ( !context ) {
					return results;
				}

				selector = selector.slice( tokens.shift().value.length );
			}

			// Fetch a seed set for right-to-left matching
			i = matchExpr["needsContext"].test( selector ) ? 0 : tokens.length;
			while ( i-- ) {
				token = tokens[i];

				// Abort if we hit a combinator
				if ( Expr.relative[ (type = token.type) ] ) {
					break;
				}
				if ( (find = Expr.find[ type ]) ) {
					// Search, expanding context for leading sibling combinators
					if ( (seed = find(
						token.matches[0].replace( runescape, funescape ),
						rsibling.test( tokens[0].type ) && context.parentNode || context
					)) ) {

						// If seed is empty or no tokens remain, we can return early
						tokens.splice( i, 1 );
						selector = seed.length && toSelector( tokens );
						if ( !selector ) {
							push.apply( results, slice.call( seed, 0 ) );
							return results;
						}

						break;
					}
				}
			}
		}
	}

	// Compile and execute a filtering function
	// Provide `match` to avoid retokenization if we modified the selector above
	compile( selector, match )(
		seed,
		context,
		documentIsXML,
		results,
		rsibling.test( selector )
	);
	return results;
}

// Deprecated
Expr.pseudos["nth"] = Expr.pseudos["eq"];

// Easy API for creating new setFilters
function setFilters() {}
Expr.filters = setFilters.prototype = Expr.pseudos;
Expr.setFilters = new setFilters();

// Initialize with the default document
setDocument();

// Override sizzle attribute retrieval
Sizzle.attr = jQuery.attr;
jQuery.find = Sizzle;
jQuery.expr = Sizzle.selectors;
jQuery.expr[":"] = jQuery.expr.pseudos;
jQuery.unique = Sizzle.uniqueSort;
jQuery.text = Sizzle.getText;
jQuery.isXMLDoc = Sizzle.isXML;
jQuery.contains = Sizzle.contains;


})( window );
var runtil = /Until$/,
	rparentsprev = /^(?:parents|prev(?:Until|All))/,
	isSimple = /^.[^:#\[\.,]*$/,
	rneedsContext = jQuery.expr.match.needsContext,
	// methods guaranteed to produce a unique set when starting from a unique set
	guaranteedUnique = {
		children: true,
		contents: true,
		next: true,
		prev: true
	};

jQuery.fn.extend({
	find: function( selector ) {
		var i, ret, self,
			len = this.length;

		if ( typeof selector !== "string" ) {
			self = this;
			return this.pushStack( jQuery( selector ).filter(function() {
				for ( i = 0; i < len; i++ ) {
					if ( jQuery.contains( self[ i ], this ) ) {
						return true;
					}
				}
			}) );
		}

		ret = [];
		for ( i = 0; i < len; i++ ) {
			jQuery.find( selector, this[ i ], ret );
		}

		// Needed because $( selector, context ) becomes $( context ).find( selector )
		ret = this.pushStack( len > 1 ? jQuery.unique( ret ) : ret );
		ret.selector = ( this.selector ? this.selector + " " : "" ) + selector;
		return ret;
	},

	has: function( target ) {
		var i,
			targets = jQuery( target, this ),
			len = targets.length;

		return this.filter(function() {
			for ( i = 0; i < len; i++ ) {
				if ( jQuery.contains( this, targets[i] ) ) {
					return true;
				}
			}
		});
	},

	not: function( selector ) {
		return this.pushStack( winnow(this, selector, false) );
	},

	filter: function( selector ) {
		return this.pushStack( winnow(this, selector, true) );
	},

	is: function( selector ) {
		return !!selector && (
			typeof selector === "string" ?
				// If this is a positional/relative selector, check membership in the returned set
				// so $("p:first").is("p:last") won't return true for a doc with two "p".
				rneedsContext.test( selector ) ?
					jQuery( selector, this.context ).index( this[0] ) >= 0 :
					jQuery.filter( selector, this ).length > 0 :
				this.filter( selector ).length > 0 );
	},

	closest: function( selectors, context ) {
		var cur,
			i = 0,
			l = this.length,
			ret = [],
			pos = rneedsContext.test( selectors ) || typeof selectors !== "string" ?
				jQuery( selectors, context || this.context ) :
				0;

		for ( ; i < l; i++ ) {
			cur = this[i];

			while ( cur && cur.ownerDocument && cur !== context && cur.nodeType !== 11 ) {
				if ( pos ? pos.index(cur) > -1 : jQuery.find.matchesSelector(cur, selectors) ) {
					ret.push( cur );
					break;
				}
				cur = cur.parentNode;
			}
		}

		return this.pushStack( ret.length > 1 ? jQuery.unique( ret ) : ret );
	},

	// Determine the position of an element within
	// the matched set of elements
	index: function( elem ) {

		// No argument, return index in parent
		if ( !elem ) {
			return ( this[0] && this[0].parentNode ) ? this.first().prevAll().length : -1;
		}

		// index in selector
		if ( typeof elem === "string" ) {
			return jQuery.inArray( this[0], jQuery( elem ) );
		}

		// Locate the position of the desired element
		return jQuery.inArray(
			// If it receives a jQuery object, the first element is used
			elem.jquery ? elem[0] : elem, this );
	},

	add: function( selector, context ) {
		var set = typeof selector === "string" ?
				jQuery( selector, context ) :
				jQuery.makeArray( selector && selector.nodeType ? [ selector ] : selector ),
			all = jQuery.merge( this.get(), set );

		return this.pushStack( jQuery.unique(all) );
	},

	addBack: function( selector ) {
		return this.add( selector == null ?
			this.prevObject : this.prevObject.filter(selector)
		);
	}
});

jQuery.fn.andSelf = jQuery.fn.addBack;

function sibling( cur, dir ) {
	do {
		cur = cur[ dir ];
	} while ( cur && cur.nodeType !== 1 );

	return cur;
}

jQuery.each({
	parent: function( elem ) {
		var parent = elem.parentNode;
		return parent && parent.nodeType !== 11 ? parent : null;
	},
	parents: function( elem ) {
		return jQuery.dir( elem, "parentNode" );
	},
	parentsUntil: function( elem, i, until ) {
		return jQuery.dir( elem, "parentNode", until );
	},
	next: function( elem ) {
		return sibling( elem, "nextSibling" );
	},
	prev: function( elem ) {
		return sibling( elem, "previousSibling" );
	},
	nextAll: function( elem ) {
		return jQuery.dir( elem, "nextSibling" );
	},
	prevAll: function( elem ) {
		return jQuery.dir( elem, "previousSibling" );
	},
	nextUntil: function( elem, i, until ) {
		return jQuery.dir( elem, "nextSibling", until );
	},
	prevUntil: function( elem, i, until ) {
		return jQuery.dir( elem, "previousSibling", until );
	},
	siblings: function( elem ) {
		return jQuery.sibling( ( elem.parentNode || {} ).firstChild, elem );
	},
	children: function( elem ) {
		return jQuery.sibling( elem.firstChild );
	},
	contents: function( elem ) {
		return jQuery.nodeName( elem, "iframe" ) ?
			elem.contentDocument || elem.contentWindow.document :
			jQuery.merge( [], elem.childNodes );
	}
}, function( name, fn ) {
	jQuery.fn[ name ] = function( until, selector ) {
		var ret = jQuery.map( this, fn, until );

		if ( !runtil.test( name ) ) {
			selector = until;
		}

		if ( selector && typeof selector === "string" ) {
			ret = jQuery.filter( selector, ret );
		}

		ret = this.length > 1 && !guaranteedUnique[ name ] ? jQuery.unique( ret ) : ret;

		if ( this.length > 1 && rparentsprev.test( name ) ) {
			ret = ret.reverse();
		}

		return this.pushStack( ret );
	};
});

jQuery.extend({
	filter: function( expr, elems, not ) {
		if ( not ) {
			expr = ":not(" + expr + ")";
		}

		return elems.length === 1 ?
			jQuery.find.matchesSelector(elems[0], expr) ? [ elems[0] ] : [] :
			jQuery.find.matches(expr, elems);
	},

	dir: function( elem, dir, until ) {
		var matched = [],
			cur = elem[ dir ];

		while ( cur && cur.nodeType !== 9 && (until === undefined || cur.nodeType !== 1 || !jQuery( cur ).is( until )) ) {
			if ( cur.nodeType === 1 ) {
				matched.push( cur );
			}
			cur = cur[dir];
		}
		return matched;
	},

	sibling: function( n, elem ) {
		var r = [];

		for ( ; n; n = n.nextSibling ) {
			if ( n.nodeType === 1 && n !== elem ) {
				r.push( n );
			}
		}

		return r;
	}
});

// Implement the identical functionality for filter and not
function winnow( elements, qualifier, keep ) {

	// Can't pass null or undefined to indexOf in Firefox 4
	// Set to 0 to skip string check
	qualifier = qualifier || 0;

	if ( jQuery.isFunction( qualifier ) ) {
		return jQuery.grep(elements, function( elem, i ) {
			var retVal = !!qualifier.call( elem, i, elem );
			return retVal === keep;
		});

	} else if ( qualifier.nodeType ) {
		return jQuery.grep(elements, function( elem ) {
			return ( elem === qualifier ) === keep;
		});

	} else if ( typeof qualifier === "string" ) {
		var filtered = jQuery.grep(elements, function( elem ) {
			return elem.nodeType === 1;
		});

		if ( isSimple.test( qualifier ) ) {
			return jQuery.filter(qualifier, filtered, !keep);
		} else {
			qualifier = jQuery.filter( qualifier, filtered );
		}
	}

	return jQuery.grep(elements, function( elem ) {
		return ( jQuery.inArray( elem, qualifier ) >= 0 ) === keep;
	});
}
function createSafeFragment( document ) {
	var list = nodeNames.split( "|" ),
		safeFrag = document.createDocumentFragment();

	if ( safeFrag.createElement ) {
		while ( list.length ) {
			safeFrag.createElement(
				list.pop()
			);
		}
	}
	return safeFrag;
}

var nodeNames = "abbr|article|aside|audio|bdi|canvas|data|datalist|details|figcaption|figure|footer|" +
		"header|hgroup|mark|meter|nav|output|progress|section|summary|time|video",
	rinlinejQuery = / jQuery\d+="(?:null|\d+)"/g,
	rnoshimcache = new RegExp("<(?:" + nodeNames + ")[\\s/>]", "i"),
	rleadingWhitespace = /^\s+/,
	rxhtmlTag = /<(?!area|br|col|embed|hr|img|input|link|meta|param)(([\w:]+)[^>]*)\/>/gi,
	rtagName = /<([\w:]+)/,
	rtbody = /<tbody/i,
	rhtml = /<|&#?\w+;/,
	rnoInnerhtml = /<(?:script|style|link)/i,
	manipulation_rcheckableType = /^(?:checkbox|radio)$/i,
	// checked="checked" or checked
	rchecked = /checked\s*(?:[^=]|=\s*.checked.)/i,
	rscriptType = /^$|\/(?:java|ecma)script/i,
	rscriptTypeMasked = /^true\/(.*)/,
	rcleanScript = /^\s*<!(?:\[CDATA\[|--)|(?:\]\]|--)>\s*$/g,

	// We have to close these tags to support XHTML (#13200)
	wrapMap = {
		option: [ 1, "<select multiple='multiple'>", "</select>" ],
		legend: [ 1, "<fieldset>", "</fieldset>" ],
		area: [ 1, "<map>", "</map>" ],
		param: [ 1, "<object>", "</object>" ],
		thead: [ 1, "<table>", "</table>" ],
		tr: [ 2, "<table><tbody>", "</tbody></table>" ],
		col: [ 2, "<table><tbody></tbody><colgroup>", "</colgroup></table>" ],
		td: [ 3, "<table><tbody><tr>", "</tr></tbody></table>" ],

		// IE6-8 can't serialize link, script, style, or any html5 (NoScope) tags,
		// unless wrapped in a div with non-breaking characters in front of it.
		_default: jQuery.support.htmlSerialize ? [ 0, "", "" ] : [ 1, "X<div>", "</div>"  ]
	},
	safeFragment = createSafeFragment( document ),
	fragmentDiv = safeFragment.appendChild( document.createElement("div") );

wrapMap.optgroup = wrapMap.option;
wrapMap.tbody = wrapMap.tfoot = wrapMap.colgroup = wrapMap.caption = wrapMap.thead;
wrapMap.th = wrapMap.td;

jQuery.fn.extend({
	text: function( value ) {
		return jQuery.access( this, function( value ) {
			return value === undefined ?
				jQuery.text( this ) :
				this.empty().append( ( this[0] && this[0].ownerDocument || document ).createTextNode( value ) );
		}, null, value, arguments.length );
	},

	wrapAll: function( html ) {
		if ( jQuery.isFunction( html ) ) {
			return this.each(function(i) {
				jQuery(this).wrapAll( html.call(this, i) );
			});
		}

		if ( this[0] ) {
			// The elements to wrap the target around
			var wrap = jQuery( html, this[0].ownerDocument ).eq(0).clone(true);

			if ( this[0].parentNode ) {
				wrap.insertBefore( this[0] );
			}

			wrap.map(function() {
				var elem = this;

				while ( elem.firstChild && elem.firstChild.nodeType === 1 ) {
					elem = elem.firstChild;
				}

				return elem;
			}).append( this );
		}

		return this;
	},

	wrapInner: function( html ) {
		if ( jQuery.isFunction( html ) ) {
			return this.each(function(i) {
				jQuery(this).wrapInner( html.call(this, i) );
			});
		}

		return this.each(function() {
			var self = jQuery( this ),
				contents = self.contents();

			if ( contents.length ) {
				contents.wrapAll( html );

			} else {
				self.append( html );
			}
		});
	},

	wrap: function( html ) {
		var isFunction = jQuery.isFunction( html );

		return this.each(function(i) {
			jQuery( this ).wrapAll( isFunction ? html.call(this, i) : html );
		});
	},

	unwrap: function() {
		return this.parent().each(function() {
			if ( !jQuery.nodeName( this, "body" ) ) {
				jQuery( this ).replaceWith( this.childNodes );
			}
		}).end();
	},

	append: function() {
		return this.domManip(arguments, true, function( elem ) {
			if ( this.nodeType === 1 || this.nodeType === 11 || this.nodeType === 9 ) {
				this.appendChild( elem );
			}
		});
	},

	prepend: function() {
		return this.domManip(arguments, true, function( elem ) {
			if ( this.nodeType === 1 || this.nodeType === 11 || this.nodeType === 9 ) {
				this.insertBefore( elem, this.firstChild );
			}
		});
	},

	before: function() {
		return this.domManip( arguments, false, function( elem ) {
			if ( this.parentNode ) {
				this.parentNode.insertBefore( elem, this );
			}
		});
	},

	after: function() {
		return this.domManip( arguments, false, function( elem ) {
			if ( this.parentNode ) {
				this.parentNode.insertBefore( elem, this.nextSibling );
			}
		});
	},

	// keepData is for internal use only--do not document
	remove: function( selector, keepData ) {
		var elem,
			i = 0;

		for ( ; (elem = this[i]) != null; i++ ) {
			if ( !selector || jQuery.filter( selector, [ elem ] ).length > 0 ) {
				if ( !keepData && elem.nodeType === 1 ) {
					jQuery.cleanData( getAll( elem ) );
				}

				if ( elem.parentNode ) {
					if ( keepData && jQuery.contains( elem.ownerDocument, elem ) ) {
						setGlobalEval( getAll( elem, "script" ) );
					}
					elem.parentNode.removeChild( elem );
				}
			}
		}

		return this;
	},

	empty: function() {
		var elem,
			i = 0;

		for ( ; (elem = this[i]) != null; i++ ) {
			// Remove element nodes and prevent memory leaks
			if ( elem.nodeType === 1 ) {
				jQuery.cleanData( getAll( elem, false ) );
			}

			// Remove any remaining nodes
			while ( elem.firstChild ) {
				elem.removeChild( elem.firstChild );
			}

			// If this is a select, ensure that it displays empty (#12336)
			// Support: IE<9
			if ( elem.options && jQuery.nodeName( elem, "select" ) ) {
				elem.options.length = 0;
			}
		}

		return this;
	},

	clone: function( dataAndEvents, deepDataAndEvents ) {
		dataAndEvents = dataAndEvents == null ? false : dataAndEvents;
		deepDataAndEvents = deepDataAndEvents == null ? dataAndEvents : deepDataAndEvents;

		return this.map( function () {
			return jQuery.clone( this, dataAndEvents, deepDataAndEvents );
		});
	},

	html: function( value ) {
		return jQuery.access( this, function( value ) {
			var elem = this[0] || {},
				i = 0,
				l = this.length;

			if ( value === undefined ) {
				return elem.nodeType === 1 ?
					elem.innerHTML.replace( rinlinejQuery, "" ) :
					undefined;
			}

			// See if we can take a shortcut and just use innerHTML
			if ( typeof value === "string" && !rnoInnerhtml.test( value ) &&
				( jQuery.support.htmlSerialize || !rnoshimcache.test( value )  ) &&
				( jQuery.support.leadingWhitespace || !rleadingWhitespace.test( value ) ) &&
				!wrapMap[ ( rtagName.exec( value ) || ["", ""] )[1].toLowerCase() ] ) {

				value = value.replace( rxhtmlTag, "<$1></$2>" );

				try {
					for (; i < l; i++ ) {
						// Remove element nodes and prevent memory leaks
						elem = this[i] || {};
						if ( elem.nodeType === 1 ) {
							jQuery.cleanData( getAll( elem, false ) );
							elem.innerHTML = value;
						}
					}

					elem = 0;

				// If using innerHTML throws an exception, use the fallback method
				} catch(e) {}
			}

			if ( elem ) {
				this.empty().append( value );
			}
		}, null, value, arguments.length );
	},

	replaceWith: function( value ) {
		var isFunc = jQuery.isFunction( value );

		// Make sure that the elements are removed from the DOM before they are inserted
		// this can help fix replacing a parent with child elements
		if ( !isFunc && typeof value !== "string" ) {
			value = jQuery( value ).not( this ).detach();
		}

		return this.domManip( [ value ], true, function( elem ) {
			var next = this.nextSibling,
				parent = this.parentNode;

			if ( parent ) {
				jQuery( this ).remove();
				parent.insertBefore( elem, next );
			}
		});
	},

	detach: function( selector ) {
		return this.remove( selector, true );
	},

	domManip: function( args, table, callback ) {

		// Flatten any nested arrays
		args = core_concat.apply( [], args );

		var first, node, hasScripts,
			scripts, doc, fragment,
			i = 0,
			l = this.length,
			set = this,
			iNoClone = l - 1,
			value = args[0],
			isFunction = jQuery.isFunction( value );

		// We can't cloneNode fragments that contain checked, in WebKit
		if ( isFunction || !( l <= 1 || typeof value !== "string" || jQuery.support.checkClone || !rchecked.test( value ) ) ) {
			return this.each(function( index ) {
				var self = set.eq( index );
				if ( isFunction ) {
					args[0] = value.call( this, index, table ? self.html() : undefined );
				}
				self.domManip( args, table, callback );
			});
		}

		if ( l ) {
			fragment = jQuery.buildFragment( args, this[ 0 ].ownerDocument, false, this );
			first = fragment.firstChild;

			if ( fragment.childNodes.length === 1 ) {
				fragment = first;
			}

			if ( first ) {
				table = table && jQuery.nodeName( first, "tr" );
				scripts = jQuery.map( getAll( fragment, "script" ), disableScript );
				hasScripts = scripts.length;

				// Use the original fragment for the last item instead of the first because it can end up
				// being emptied incorrectly in certain situations (#8070).
				for ( ; i < l; i++ ) {
					node = fragment;

					if ( i !== iNoClone ) {
						node = jQuery.clone( node, true, true );

						// Keep references to cloned scripts for later restoration
						if ( hasScripts ) {
							jQuery.merge( scripts, getAll( node, "script" ) );
						}
					}

					callback.call(
						table && jQuery.nodeName( this[i], "table" ) ?
							findOrAppend( this[i], "tbody" ) :
							this[i],
						node,
						i
					);
				}

				if ( hasScripts ) {
					doc = scripts[ scripts.length - 1 ].ownerDocument;

					// Reenable scripts
					jQuery.map( scripts, restoreScript );

					// Evaluate executable scripts on first document insertion
					for ( i = 0; i < hasScripts; i++ ) {
						node = scripts[ i ];
						if ( rscriptType.test( node.type || "" ) &&
							!jQuery._data( node, "globalEval" ) && jQuery.contains( doc, node ) ) {

							if ( node.src ) {
								// Hope ajax is available...
								jQuery.ajax({
									url: node.src,
									type: "GET",
									dataType: "script",
									async: false,
									global: false,
									"throws": true
								});
							} else {
								jQuery.globalEval( ( node.text || node.textContent || node.innerHTML || "" ).replace( rcleanScript, "" ) );
							}
						}
					}
				}

				// Fix #11809: Avoid leaking memory
				fragment = first = null;
			}
		}

		return this;
	}
});

function findOrAppend( elem, tag ) {
	return elem.getElementsByTagName( tag )[0] || elem.appendChild( elem.ownerDocument.createElement( tag ) );
}

// Replace/restore the type attribute of script elements for safe DOM manipulation
function disableScript( elem ) {
	var attr = elem.getAttributeNode("type");
	elem.type = ( attr && attr.specified ) + "/" + elem.type;
	return elem;
}
function restoreScript( elem ) {
	var match = rscriptTypeMasked.exec( elem.type );
	if ( match ) {
		elem.type = match[1];
	} else {
		elem.removeAttribute("type");
	}
	return elem;
}

// Mark scripts as having already been evaluated
function setGlobalEval( elems, refElements ) {
	var elem,
		i = 0;
	for ( ; (elem = elems[i]) != null; i++ ) {
		jQuery._data( elem, "globalEval", !refElements || jQuery._data( refElements[i], "globalEval" ) );
	}
}

function cloneCopyEvent( src, dest ) {

	if ( dest.nodeType !== 1 || !jQuery.hasData( src ) ) {
		return;
	}

	var type, i, l,
		oldData = jQuery._data( src ),
		curData = jQuery._data( dest, oldData ),
		events = oldData.events;

	if ( events ) {
		delete curData.handle;
		curData.events = {};

		for ( type in events ) {
			for ( i = 0, l = events[ type ].length; i < l; i++ ) {
				jQuery.event.add( dest, type, events[ type ][ i ] );
			}
		}
	}

	// make the cloned public data object a copy from the original
	if ( curData.data ) {
		curData.data = jQuery.extend( {}, curData.data );
	}
}

function fixCloneNodeIssues( src, dest ) {
	var nodeName, e, data;

	// We do not need to do anything for non-Elements
	if ( dest.nodeType !== 1 ) {
		return;
	}

	nodeName = dest.nodeName.toLowerCase();

	// IE6-8 copies events bound via attachEvent when using cloneNode.
	if ( !jQuery.support.noCloneEvent && dest[ jQuery.expando ] ) {
		data = jQuery._data( dest );

		for ( e in data.events ) {
			jQuery.removeEvent( dest, e, data.handle );
		}

		// Event data gets referenced instead of copied if the expando gets copied too
		dest.removeAttribute( jQuery.expando );
	}

	// IE blanks contents when cloning scripts, and tries to evaluate newly-set text
	if ( nodeName === "script" && dest.text !== src.text ) {
		disableScript( dest ).text = src.text;
		restoreScript( dest );

	// IE6-10 improperly clones children of object elements using classid.
	// IE10 throws NoModificationAllowedError if parent is null, #12132.
	} else if ( nodeName === "object" ) {
		if ( dest.parentNode ) {
			dest.outerHTML = src.outerHTML;
		}

		// This path appears unavoidable for IE9. When cloning an object
		// element in IE9, the outerHTML strategy above is not sufficient.
		// If the src has innerHTML and the destination does not,
		// copy the src.innerHTML into the dest.innerHTML. #10324
		if ( jQuery.support.html5Clone && ( src.innerHTML && !jQuery.trim(dest.innerHTML) ) ) {
			dest.innerHTML = src.innerHTML;
		}

	} else if ( nodeName === "input" && manipulation_rcheckableType.test( src.type ) ) {
		// IE6-8 fails to persist the checked state of a cloned checkbox
		// or radio button. Worse, IE6-7 fail to give the cloned element
		// a checked appearance if the defaultChecked value isn't also set

		dest.defaultChecked = dest.checked = src.checked;

		// IE6-7 get confused and end up setting the value of a cloned
		// checkbox/radio button to an empty string instead of "on"
		if ( dest.value !== src.value ) {
			dest.value = src.value;
		}

	// IE6-8 fails to return the selected option to the default selected
	// state when cloning options
	} else if ( nodeName === "option" ) {
		dest.defaultSelected = dest.selected = src.defaultSelected;

	// IE6-8 fails to set the defaultValue to the correct value when
	// cloning other types of input fields
	} else if ( nodeName === "input" || nodeName === "textarea" ) {
		dest.defaultValue = src.defaultValue;
	}
}

jQuery.each({
	appendTo: "append",
	prependTo: "prepend",
	insertBefore: "before",
	insertAfter: "after",
	replaceAll: "replaceWith"
}, function( name, original ) {
	jQuery.fn[ name ] = function( selector ) {
		var elems,
			i = 0,
			ret = [],
			insert = jQuery( selector ),
			last = insert.length - 1;

		for ( ; i <= last; i++ ) {
			elems = i === last ? this : this.clone(true);
			jQuery( insert[i] )[ original ]( elems );

			// Modern browsers can apply jQuery collections as arrays, but oldIE needs a .get()
			core_push.apply( ret, elems.get() );
		}

		return this.pushStack( ret );
	};
});

function getAll( context, tag ) {
	var elems, elem,
		i = 0,
		found = typeof context.getElementsByTagName !== core_strundefined ? context.getElementsByTagName( tag || "*" ) :
			typeof context.querySelectorAll !== core_strundefined ? context.querySelectorAll( tag || "*" ) :
			undefined;

	if ( !found ) {
		for ( found = [], elems = context.childNodes || context; (elem = elems[i]) != null; i++ ) {
			if ( !tag || jQuery.nodeName( elem, tag ) ) {
				found.push( elem );
			} else {
				jQuery.merge( found, getAll( elem, tag ) );
			}
		}
	}

	return tag === undefined || tag && jQuery.nodeName( context, tag ) ?
		jQuery.merge( [ context ], found ) :
		found;
}

// Used in buildFragment, fixes the defaultChecked property
function fixDefaultChecked( elem ) {
	if ( manipulation_rcheckableType.test( elem.type ) ) {
		elem.defaultChecked = elem.checked;
	}
}

jQuery.extend({
	clone: function( elem, dataAndEvents, deepDataAndEvents ) {
		var destElements, node, clone, i, srcElements,
			inPage = jQuery.contains( elem.ownerDocument, elem );

		if ( jQuery.support.html5Clone || jQuery.isXMLDoc(elem) || !rnoshimcache.test( "<" + elem.nodeName + ">" ) ) {
			clone = elem.cloneNode( true );

		// IE<=8 does not properly clone detached, unknown element nodes
		} else {
			fragmentDiv.innerHTML = elem.outerHTML;
			fragmentDiv.removeChild( clone = fragmentDiv.firstChild );
		}

		if ( (!jQuery.support.noCloneEvent || !jQuery.support.noCloneChecked) &&
				(elem.nodeType === 1 || elem.nodeType === 11) && !jQuery.isXMLDoc(elem) ) {

			// We eschew Sizzle here for performance reasons: http://jsperf.com/getall-vs-sizzle/2
			destElements = getAll( clone );
			srcElements = getAll( elem );

			// Fix all IE cloning issues
			for ( i = 0; (node = srcElements[i]) != null; ++i ) {
				// Ensure that the destination node is not null; Fixes #9587
				if ( destElements[i] ) {
					fixCloneNodeIssues( node, destElements[i] );
				}
			}
		}

		// Copy the events from the original to the clone
		if ( dataAndEvents ) {
			if ( deepDataAndEvents ) {
				srcElements = srcElements || getAll( elem );
				destElements = destElements || getAll( clone );

				for ( i = 0; (node = srcElements[i]) != null; i++ ) {
					cloneCopyEvent( node, destElements[i] );
				}
			} else {
				cloneCopyEvent( elem, clone );
			}
		}

		// Preserve script evaluation history
		destElements = getAll( clone, "script" );
		if ( destElements.length > 0 ) {
			setGlobalEval( destElements, !inPage && getAll( elem, "script" ) );
		}

		destElements = srcElements = node = null;

		// Return the cloned set
		return clone;
	},

	buildFragment: function( elems, context, scripts, selection ) {
		var j, elem, contains,
			tmp, tag, tbody, wrap,
			l = elems.length,

			// Ensure a safe fragment
			safe = createSafeFragment( context ),

			nodes = [],
			i = 0;

		for ( ; i < l; i++ ) {
			elem = elems[ i ];

			if ( elem || elem === 0 ) {

				// Add nodes directly
				if ( jQuery.type( elem ) === "object" ) {
					jQuery.merge( nodes, elem.nodeType ? [ elem ] : elem );

				// Convert non-html into a text node
				} else if ( !rhtml.test( elem ) ) {
					nodes.push( context.createTextNode( elem ) );

				// Convert html into DOM nodes
				} else {
					tmp = tmp || safe.appendChild( context.createElement("div") );

					// Deserialize a standard representation
					tag = ( rtagName.exec( elem ) || ["", ""] )[1].toLowerCase();
					wrap = wrapMap[ tag ] || wrapMap._default;

					tmp.innerHTML = wrap[1] + elem.replace( rxhtmlTag, "<$1></$2>" ) + wrap[2];

					// Descend through wrappers to the right content
					j = wrap[0];
					while ( j-- ) {
						tmp = tmp.lastChild;
					}

					// Manually add leading whitespace removed by IE
					if ( !jQuery.support.leadingWhitespace && rleadingWhitespace.test( elem ) ) {
						nodes.push( context.createTextNode( rleadingWhitespace.exec( elem )[0] ) );
					}

					// Remove IE's autoinserted <tbody> from table fragments
					if ( !jQuery.support.tbody ) {

						// String was a <table>, *may* have spurious <tbody>
						elem = tag === "table" && !rtbody.test( elem ) ?
							tmp.firstChild :

							// String was a bare <thead> or <tfoot>
							wrap[1] === "<table>" && !rtbody.test( elem ) ?
								tmp :
								0;

						j = elem && elem.childNodes.length;
						while ( j-- ) {
							if ( jQuery.nodeName( (tbody = elem.childNodes[j]), "tbody" ) && !tbody.childNodes.length ) {
								elem.removeChild( tbody );
							}
						}
					}

					jQuery.merge( nodes, tmp.childNodes );

					// Fix #12392 for WebKit and IE > 9
					tmp.textContent = "";

					// Fix #12392 for oldIE
					while ( tmp.firstChild ) {
						tmp.removeChild( tmp.firstChild );
					}

					// Remember the top-level container for proper cleanup
					tmp = safe.lastChild;
				}
			}
		}

		// Fix #11356: Clear elements from fragment
		if ( tmp ) {
			safe.removeChild( tmp );
		}

		// Reset defaultChecked for any radios and checkboxes
		// about to be appended to the DOM in IE 6/7 (#8060)
		if ( !jQuery.support.appendChecked ) {
			jQuery.grep( getAll( nodes, "input" ), fixDefaultChecked );
		}

		i = 0;
		while ( (elem = nodes[ i++ ]) ) {

			// #4087 - If origin and destination elements are the same, and this is
			// that element, do not do anything
			if ( selection && jQuery.inArray( elem, selection ) !== -1 ) {
				continue;
			}

			contains = jQuery.contains( elem.ownerDocument, elem );

			// Append to fragment
			tmp = getAll( safe.appendChild( elem ), "script" );

			// Preserve script evaluation history
			if ( contains ) {
				setGlobalEval( tmp );
			}

			// Capture executables
			if ( scripts ) {
				j = 0;
				while ( (elem = tmp[ j++ ]) ) {
					if ( rscriptType.test( elem.type || "" ) ) {
						scripts.push( elem );
					}
				}
			}
		}

		tmp = null;

		return safe;
	},

	cleanData: function( elems, /* internal */ acceptData ) {
		var elem, type, id, data,
			i = 0,
			internalKey = jQuery.expando,
			cache = jQuery.cache,
			deleteExpando = jQuery.support.deleteExpando,
			special = jQuery.event.special;

		for ( ; (elem = elems[i]) != null; i++ ) {

			if ( acceptData || jQuery.acceptData( elem ) ) {

				id = elem[ internalKey ];
				data = id && cache[ id ];

				if ( data ) {
					if ( data.events ) {
						for ( type in data.events ) {
							if ( special[ type ] ) {
								jQuery.event.remove( elem, type );

							// This is a shortcut to avoid jQuery.event.remove's overhead
							} else {
								jQuery.removeEvent( elem, type, data.handle );
							}
						}
					}

					// Remove cache only if it was not already removed by jQuery.event.remove
					if ( cache[ id ] ) {

						delete cache[ id ];

						// IE does not allow us to delete expando properties from nodes,
						// nor does it have a removeAttribute function on Document nodes;
						// we must handle all of these cases
						if ( deleteExpando ) {
							delete elem[ internalKey ];

						} else if ( typeof elem.removeAttribute !== core_strundefined ) {
							elem.removeAttribute( internalKey );

						} else {
							elem[ internalKey ] = null;
						}

						core_deletedIds.push( id );
					}
				}
			}
		}
	}
});
var iframe, getStyles, curCSS,
	ralpha = /alpha\([^)]*\)/i,
	ropacity = /opacity\s*=\s*([^)]*)/,
	rposition = /^(top|right|bottom|left)$/,
	// swappable if display is none or starts with table except "table", "table-cell", or "table-caption"
	// see here for display values: https://developer.mozilla.org/en-US/docs/CSS/display
	rdisplayswap = /^(none|table(?!-c[ea]).+)/,
	rmargin = /^margin/,
	rnumsplit = new RegExp( "^(" + core_pnum + ")(.*)$", "i" ),
	rnumnonpx = new RegExp( "^(" + core_pnum + ")(?!px)[a-z%]+$", "i" ),
	rrelNum = new RegExp( "^([+-])=(" + core_pnum + ")", "i" ),
	elemdisplay = { BODY: "block" },

	cssShow = { position: "absolute", visibility: "hidden", display: "block" },
	cssNormalTransform = {
		letterSpacing: 0,
		fontWeight: 400
	},

	cssExpand = [ "Top", "Right", "Bottom", "Left" ],
	cssPrefixes = [ "Webkit", "O", "Moz", "ms" ];

// return a css property mapped to a potentially vendor prefixed property
function vendorPropName( style, name ) {

	// shortcut for names that are not vendor prefixed
	if ( name in style ) {
		return name;
	}

	// check for vendor prefixed names
	var capName = name.charAt(0).toUpperCase() + name.slice(1),
		origName = name,
		i = cssPrefixes.length;

	while ( i-- ) {
		name = cssPrefixes[ i ] + capName;
		if ( name in style ) {
			return name;
		}
	}

	return origName;
}

function isHidden( elem, el ) {
	// isHidden might be called from jQuery#filter function;
	// in that case, element will be second argument
	elem = el || elem;
	return jQuery.css( elem, "display" ) === "none" || !jQuery.contains( elem.ownerDocument, elem );
}

function showHide( elements, show ) {
	var display, elem, hidden,
		values = [],
		index = 0,
		length = elements.length;

	for ( ; index < length; index++ ) {
		elem = elements[ index ];
		if ( !elem.style ) {
			continue;
		}

		values[ index ] = jQuery._data( elem, "olddisplay" );
		display = elem.style.display;
		if ( show ) {
			// Reset the inline display of this element to learn if it is
			// being hidden by cascaded rules or not
			if ( !values[ index ] && display === "none" ) {
				elem.style.display = "";
			}

			// Set elements which have been overridden with display: none
			// in a stylesheet to whatever the default browser style is
			// for such an element
			if ( elem.style.display === "" && isHidden( elem ) ) {
				values[ index ] = jQuery._data( elem, "olddisplay", css_defaultDisplay(elem.nodeName) );
			}
		} else {

			if ( !values[ index ] ) {
				hidden = isHidden( elem );

				if ( display && display !== "none" || !hidden ) {
					jQuery._data( elem, "olddisplay", hidden ? display : jQuery.css( elem, "display" ) );
				}
			}
		}
	}

	// Set the display of most of the elements in a second loop
	// to avoid the constant reflow
	for ( index = 0; index < length; index++ ) {
		elem = elements[ index ];
		if ( !elem.style ) {
			continue;
		}
		if ( !show || elem.style.display === "none" || elem.style.display === "" ) {
			elem.style.display = show ? values[ index ] || "" : "none";
		}
	}

	return elements;
}

jQuery.fn.extend({
	css: function( name, value ) {
		return jQuery.access( this, function( elem, name, value ) {
			var len, styles,
				map = {},
				i = 0;

			if ( jQuery.isArray( name ) ) {
				styles = getStyles( elem );
				len = name.length;

				for ( ; i < len; i++ ) {
					map[ name[ i ] ] = jQuery.css( elem, name[ i ], false, styles );
				}

				return map;
			}

			return value !== undefined ?
				jQuery.style( elem, name, value ) :
				jQuery.css( elem, name );
		}, name, value, arguments.length > 1 );
	},
	show: function() {
		return showHide( this, true );
	},
	hide: function() {
		return showHide( this );
	},
	toggle: function( state ) {
		var bool = typeof state === "boolean";

		return this.each(function() {
			if ( bool ? state : isHidden( this ) ) {
				jQuery( this ).show();
			} else {
				jQuery( this ).hide();
			}
		});
	}
});

jQuery.extend({
	// Add in style property hooks for overriding the default
	// behavior of getting and setting a style property
	cssHooks: {
		opacity: {
			get: function( elem, computed ) {
				if ( computed ) {
					// We should always get a number back from opacity
					var ret = curCSS( elem, "opacity" );
					return ret === "" ? "1" : ret;
				}
			}
		}
	},

	// Exclude the following css properties to add px
	cssNumber: {
		"columnCount": true,
		"fillOpacity": true,
		"fontWeight": true,
		"lineHeight": true,
		"opacity": true,
		"orphans": true,
		"widows": true,
		"zIndex": true,
		"zoom": true
	},

	// Add in properties whose names you wish to fix before
	// setting or getting the value
	cssProps: {
		// normalize float css property
		"float": jQuery.support.cssFloat ? "cssFloat" : "styleFloat"
	},

	// Get and set the style property on a DOM Node
	style: function( elem, name, value, extra ) {
		// Don't set styles on text and comment nodes
		if ( !elem || elem.nodeType === 3 || elem.nodeType === 8 || !elem.style ) {
			return;
		}

		// Make sure that we're working with the right name
		var ret, type, hooks,
			origName = jQuery.camelCase( name ),
			style = elem.style;

		name = jQuery.cssProps[ origName ] || ( jQuery.cssProps[ origName ] = vendorPropName( style, origName ) );

		// gets hook for the prefixed version
		// followed by the unprefixed version
		hooks = jQuery.cssHooks[ name ] || jQuery.cssHooks[ origName ];

		// Check if we're setting a value
		if ( value !== undefined ) {
			type = typeof value;

			// convert relative number strings (+= or -=) to relative numbers. #7345
			if ( type === "string" && (ret = rrelNum.exec( value )) ) {
				value = ( ret[1] + 1 ) * ret[2] + parseFloat( jQuery.css( elem, name ) );
				// Fixes bug #9237
				type = "number";
			}

			// Make sure that NaN and null values aren't set. See: #7116
			if ( value == null || type === "number" && isNaN( value ) ) {
				return;
			}

			// If a number was passed in, add 'px' to the (except for certain CSS properties)
			if ( type === "number" && !jQuery.cssNumber[ origName ] ) {
				value += "px";
			}

			// Fixes #8908, it can be done more correctly by specifing setters in cssHooks,
			// but it would mean to define eight (for every problematic property) identical functions
			if ( !jQuery.support.clearCloneStyle && value === "" && name.indexOf("background") === 0 ) {
				style[ name ] = "inherit";
			}

			// If a hook was provided, use that value, otherwise just set the specified value
			if ( !hooks || !("set" in hooks) || (value = hooks.set( elem, value, extra )) !== undefined ) {

				// Wrapped to prevent IE from throwing errors when 'invalid' values are provided
				// Fixes bug #5509
				try {
					style[ name ] = value;
				} catch(e) {}
			}

		} else {
			// If a hook was provided get the non-computed value from there
			if ( hooks && "get" in hooks && (ret = hooks.get( elem, false, extra )) !== undefined ) {
				return ret;
			}

			// Otherwise just get the value from the style object
			return style[ name ];
		}
	},

	css: function( elem, name, extra, styles ) {
		var num, val, hooks,
			origName = jQuery.camelCase( name );

		// Make sure that we're working with the right name
		name = jQuery.cssProps[ origName ] || ( jQuery.cssProps[ origName ] = vendorPropName( elem.style, origName ) );

		// gets hook for the prefixed version
		// followed by the unprefixed version
		hooks = jQuery.cssHooks[ name ] || jQuery.cssHooks[ origName ];

		// If a hook was provided get the computed value from there
		if ( hooks && "get" in hooks ) {
			val = hooks.get( elem, true, extra );
		}

		// Otherwise, if a way to get the computed value exists, use that
		if ( val === undefined ) {
			val = curCSS( elem, name, styles );
		}

		//convert "normal" to computed value
		if ( val === "normal" && name in cssNormalTransform ) {
			val = cssNormalTransform[ name ];
		}

		// Return, converting to number if forced or a qualifier was provided and val looks numeric
		if ( extra === "" || extra ) {
			num = parseFloat( val );
			return extra === true || jQuery.isNumeric( num ) ? num || 0 : val;
		}
		return val;
	},

	// A method for quickly swapping in/out CSS properties to get correct calculations
	swap: function( elem, options, callback, args ) {
		var ret, name,
			old = {};

		// Remember the old values, and insert the new ones
		for ( name in options ) {
			old[ name ] = elem.style[ name ];
			elem.style[ name ] = options[ name ];
		}

		ret = callback.apply( elem, args || [] );

		// Revert the old values
		for ( name in options ) {
			elem.style[ name ] = old[ name ];
		}

		return ret;
	}
});

// NOTE: we've included the "window" in window.getComputedStyle
// because jsdom on node.js will break without it.
if ( window.getComputedStyle ) {
	getStyles = function( elem ) {
		return window.getComputedStyle( elem, null );
	};

	curCSS = function( elem, name, _computed ) {
		var width, minWidth, maxWidth,
			computed = _computed || getStyles( elem ),

			// getPropertyValue is only needed for .css('filter') in IE9, see #12537
			ret = computed ? computed.getPropertyValue( name ) || computed[ name ] : undefined,
			style = elem.style;

		if ( computed ) {

			if ( ret === "" && !jQuery.contains( elem.ownerDocument, elem ) ) {
				ret = jQuery.style( elem, name );
			}

			// A tribute to the "awesome hack by Dean Edwards"
			// Chrome < 17 and Safari 5.0 uses "computed value" instead of "used value" for margin-right
			// Safari 5.1.7 (at least) returns percentage for a larger set of values, but width seems to be reliably pixels
			// this is against the CSSOM draft spec: http://dev.w3.org/csswg/cssom/#resolved-values
			if ( rnumnonpx.test( ret ) && rmargin.test( name ) ) {

				// Remember the original values
				width = style.width;
				minWidth = style.minWidth;
				maxWidth = style.maxWidth;

				// Put in the new values to get a computed value out
				style.minWidth = style.maxWidth = style.width = ret;
				ret = computed.width;

				// Revert the changed values
				style.width = width;
				style.minWidth = minWidth;
				style.maxWidth = maxWidth;
			}
		}

		return ret;
	};
} else if ( document.documentElement.currentStyle ) {
	getStyles = function( elem ) {
		return elem.currentStyle;
	};

	curCSS = function( elem, name, _computed ) {
		var left, rs, rsLeft,
			computed = _computed || getStyles( elem ),
			ret = computed ? computed[ name ] : undefined,
			style = elem.style;

		// Avoid setting ret to empty string here
		// so we don't default to auto
		if ( ret == null && style && style[ name ] ) {
			ret = style[ name ];
		}

		// From the awesome hack by Dean Edwards
		// http://erik.eae.net/archives/2007/07/27/18.54.15/#comment-102291

		// If we're not dealing with a regular pixel number
		// but a number that has a weird ending, we need to convert it to pixels
		// but not position css attributes, as those are proportional to the parent element instead
		// and we can't measure the parent instead because it might trigger a "stacking dolls" problem
		if ( rnumnonpx.test( ret ) && !rposition.test( name ) ) {

			// Remember the original values
			left = style.left;
			rs = elem.runtimeStyle;
			rsLeft = rs && rs.left;

			// Put in the new values to get a computed value out
			if ( rsLeft ) {
				rs.left = elem.currentStyle.left;
			}
			style.left = name === "fontSize" ? "1em" : ret;
			ret = style.pixelLeft + "px";

			// Revert the changed values
			style.left = left;
			if ( rsLeft ) {
				rs.left = rsLeft;
			}
		}

		return ret === "" ? "auto" : ret;
	};
}

function setPositiveNumber( elem, value, subtract ) {
	var matches = rnumsplit.exec( value );
	return matches ?
		// Guard against undefined "subtract", e.g., when used as in cssHooks
		Math.max( 0, matches[ 1 ] - ( subtract || 0 ) ) + ( matches[ 2 ] || "px" ) :
		value;
}

function augmentWidthOrHeight( elem, name, extra, isBorderBox, styles ) {
	var i = extra === ( isBorderBox ? "border" : "content" ) ?
		// If we already have the right measurement, avoid augmentation
		4 :
		// Otherwise initialize for horizontal or vertical properties
		name === "width" ? 1 : 0,

		val = 0;

	for ( ; i < 4; i += 2 ) {
		// both box models exclude margin, so add it if we want it
		if ( extra === "margin" ) {
			val += jQuery.css( elem, extra + cssExpand[ i ], true, styles );
		}

		if ( isBorderBox ) {
			// border-box includes padding, so remove it if we want content
			if ( extra === "content" ) {
				val -= jQuery.css( elem, "padding" + cssExpand[ i ], true, styles );
			}

			// at this point, extra isn't border nor margin, so remove border
			if ( extra !== "margin" ) {
				val -= jQuery.css( elem, "border" + cssExpand[ i ] + "Width", true, styles );
			}
		} else {
			// at this point, extra isn't content, so add padding
			val += jQuery.css( elem, "padding" + cssExpand[ i ], true, styles );

			// at this point, extra isn't content nor padding, so add border
			if ( extra !== "padding" ) {
				val += jQuery.css( elem, "border" + cssExpand[ i ] + "Width", true, styles );
			}
		}
	}

	return val;
}

function getWidthOrHeight( elem, name, extra ) {

	// Start with offset property, which is equivalent to the border-box value
	var valueIsBorderBox = true,
		val = name === "width" ? elem.offsetWidth : elem.offsetHeight,
		styles = getStyles( elem ),
		isBorderBox = jQuery.support.boxSizing && jQuery.css( elem, "boxSizing", false, styles ) === "border-box";

	// some non-html elements return undefined for offsetWidth, so check for null/undefined
	// svg - https://bugzilla.mozilla.org/show_bug.cgi?id=649285
	// MathML - https://bugzilla.mozilla.org/show_bug.cgi?id=491668
	if ( val <= 0 || val == null ) {
		// Fall back to computed then uncomputed css if necessary
		val = curCSS( elem, name, styles );
		if ( val < 0 || val == null ) {
			val = elem.style[ name ];
		}

		// Computed unit is not pixels. Stop here and return.
		if ( rnumnonpx.test(val) ) {
			return val;
		}

		// we need the check for style in case a browser which returns unreliable values
		// for getComputedStyle silently falls back to the reliable elem.style
		valueIsBorderBox = isBorderBox && ( jQuery.support.boxSizingReliable || val === elem.style[ name ] );

		// Normalize "", auto, and prepare for extra
		val = parseFloat( val ) || 0;
	}

	// use the active box-sizing model to add/subtract irrelevant styles
	return ( val +
		augmentWidthOrHeight(
			elem,
			name,
			extra || ( isBorderBox ? "border" : "content" ),
			valueIsBorderBox,
			styles
		)
	) + "px";
}

// Try to determine the default display value of an element
function css_defaultDisplay( nodeName ) {
	var doc = document,
		display = elemdisplay[ nodeName ];

	if ( !display ) {
		display = actualDisplay( nodeName, doc );

		// If the simple way fails, read from inside an iframe
		if ( display === "none" || !display ) {
			// Use the already-created iframe if possible
			iframe = ( iframe ||
				jQuery("<iframe frameborder='0' width='0' height='0'/>")
				.css( "cssText", "display:block !important" )
			).appendTo( doc.documentElement );

			// Always write a new HTML skeleton so Webkit and Firefox don't choke on reuse
			doc = ( iframe[0].contentWindow || iframe[0].contentDocument ).document;
			doc.write("<!doctype html><html><body>");
			doc.close();

			display = actualDisplay( nodeName, doc );
			iframe.detach();
		}

		// Store the correct default display
		elemdisplay[ nodeName ] = display;
	}

	return display;
}

// Called ONLY from within css_defaultDisplay
function actualDisplay( name, doc ) {
	var elem = jQuery( doc.createElement( name ) ).appendTo( doc.body ),
		display = jQuery.css( elem[0], "display" );
	elem.remove();
	return display;
}

jQuery.each([ "height", "width" ], function( i, name ) {
	jQuery.cssHooks[ name ] = {
		get: function( elem, computed, extra ) {
			if ( computed ) {
				// certain elements can have dimension info if we invisibly show them
				// however, it must have a current display style that would benefit from this
				return elem.offsetWidth === 0 && rdisplayswap.test( jQuery.css( elem, "display" ) ) ?
					jQuery.swap( elem, cssShow, function() {
						return getWidthOrHeight( elem, name, extra );
					}) :
					getWidthOrHeight( elem, name, extra );
			}
		},

		set: function( elem, value, extra ) {
			var styles = extra && getStyles( elem );
			return setPositiveNumber( elem, value, extra ?
				augmentWidthOrHeight(
					elem,
					name,
					extra,
					jQuery.support.boxSizing && jQuery.css( elem, "boxSizing", false, styles ) === "border-box",
					styles
				) : 0
			);
		}
	};
});

if ( !jQuery.support.opacity ) {
	jQuery.cssHooks.opacity = {
		get: function( elem, computed ) {
			// IE uses filters for opacity
			return ropacity.test( (computed && elem.currentStyle ? elem.currentStyle.filter : elem.style.filter) || "" ) ?
				( 0.01 * parseFloat( RegExp.$1 ) ) + "" :
				computed ? "1" : "";
		},

		set: function( elem, value ) {
			var style = elem.style,
				currentStyle = elem.currentStyle,
				opacity = jQuery.isNumeric( value ) ? "alpha(opacity=" + value * 100 + ")" : "",
				filter = currentStyle && currentStyle.filter || style.filter || "";

			// IE has trouble with opacity if it does not have layout
			// Force it by setting the zoom level
			style.zoom = 1;

			// if setting opacity to 1, and no other filters exist - attempt to remove filter attribute #6652
			// if value === "", then remove inline opacity #12685
			if ( ( value >= 1 || value === "" ) &&
					jQuery.trim( filter.replace( ralpha, "" ) ) === "" &&
					style.removeAttribute ) {

				// Setting style.filter to null, "" & " " still leave "filter:" in the cssText
				// if "filter:" is present at all, clearType is disabled, we want to avoid this
				// style.removeAttribute is IE Only, but so apparently is this code path...
				style.removeAttribute( "filter" );

				// if there is no filter style applied in a css rule or unset inline opacity, we are done
				if ( value === "" || currentStyle && !currentStyle.filter ) {
					return;
				}
			}

			// otherwise, set new filter values
			style.filter = ralpha.test( filter ) ?
				filter.replace( ralpha, opacity ) :
				filter + " " + opacity;
		}
	};
}

// These hooks cannot be added until DOM ready because the support test
// for it is not run until after DOM ready
jQuery(function() {
	if ( !jQuery.support.reliableMarginRight ) {
		jQuery.cssHooks.marginRight = {
			get: function( elem, computed ) {
				if ( computed ) {
					// WebKit Bug 13343 - getComputedStyle returns wrong value for margin-right
					// Work around by temporarily setting element display to inline-block
					return jQuery.swap( elem, { "display": "inline-block" },
						curCSS, [ elem, "marginRight" ] );
				}
			}
		};
	}

	// Webkit bug: https://bugs.webkit.org/show_bug.cgi?id=29084
	// getComputedStyle returns percent when specified for top/left/bottom/right
	// rather than make the css module depend on the offset module, we just check for it here
	if ( !jQuery.support.pixelPosition && jQuery.fn.position ) {
		jQuery.each( [ "top", "left" ], function( i, prop ) {
			jQuery.cssHooks[ prop ] = {
				get: function( elem, computed ) {
					if ( computed ) {
						computed = curCSS( elem, prop );
						// if curCSS returns percentage, fallback to offset
						return rnumnonpx.test( computed ) ?
							jQuery( elem ).position()[ prop ] + "px" :
							computed;
					}
				}
			};
		});
	}

});

if ( jQuery.expr && jQuery.expr.filters ) {
	jQuery.expr.filters.hidden = function( elem ) {
		// Support: Opera <= 12.12
		// Opera reports offsetWidths and offsetHeights less than zero on some elements
		return elem.offsetWidth <= 0 && elem.offsetHeight <= 0 ||
			(!jQuery.support.reliableHiddenOffsets && ((elem.style && elem.style.display) || jQuery.css( elem, "display" )) === "none");
	};

	jQuery.expr.filters.visible = function( elem ) {
		return !jQuery.expr.filters.hidden( elem );
	};
}

// These hooks are used by animate to expand properties
jQuery.each({
	margin: "",
	padding: "",
	border: "Width"
}, function( prefix, suffix ) {
	jQuery.cssHooks[ prefix + suffix ] = {
		expand: function( value ) {
			var i = 0,
				expanded = {},

				// assumes a single number if not a string
				parts = typeof value === "string" ? value.split(" ") : [ value ];

			for ( ; i < 4; i++ ) {
				expanded[ prefix + cssExpand[ i ] + suffix ] =
					parts[ i ] || parts[ i - 2 ] || parts[ 0 ];
			}

			return expanded;
		}
	};

	if ( !rmargin.test( prefix ) ) {
		jQuery.cssHooks[ prefix + suffix ].set = setPositiveNumber;
	}
});
var r20 = /%20/g,
	rbracket = /\[\]$/,
	rCRLF = /\r?\n/g,
	rsubmitterTypes = /^(?:submit|button|image|reset|file)$/i,
	rsubmittable = /^(?:input|select|textarea|keygen)/i;

jQuery.fn.extend({
	serialize: function() {
		return jQuery.param( this.serializeArray() );
	},
	serializeArray: function() {
		return this.map(function(){
			// Can add propHook for "elements" to filter or add form elements
			var elements = jQuery.prop( this, "elements" );
			return elements ? jQuery.makeArray( elements ) : this;
		})
		.filter(function(){
			var type = this.type;
			// Use .is(":disabled") so that fieldset[disabled] works
			return this.name && !jQuery( this ).is( ":disabled" ) &&
				rsubmittable.test( this.nodeName ) && !rsubmitterTypes.test( type ) &&
				( this.checked || !manipulation_rcheckableType.test( type ) );
		})
		.map(function( i, elem ){
			var val = jQuery( this ).val();

			return val == null ?
				null :
				jQuery.isArray( val ) ?
					jQuery.map( val, function( val ){
						return { name: elem.name, value: val.replace( rCRLF, "\r\n" ) };
					}) :
					{ name: elem.name, value: val.replace( rCRLF, "\r\n" ) };
		}).get();
	}
});

//Serialize an array of form elements or a set of
//key/values into a query string
jQuery.param = function( a, traditional ) {
	var prefix,
		s = [],
		add = function( key, value ) {
			// If value is a function, invoke it and return its value
			value = jQuery.isFunction( value ) ? value() : ( value == null ? "" : value );
			s[ s.length ] = encodeURIComponent( key ) + "=" + encodeURIComponent( value );
		};

	// Set traditional to true for jQuery <= 1.3.2 behavior.
	if ( traditional === undefined ) {
		traditional = jQuery.ajaxSettings && jQuery.ajaxSettings.traditional;
	}

	// If an array was passed in, assume that it is an array of form elements.
	if ( jQuery.isArray( a ) || ( a.jquery && !jQuery.isPlainObject( a ) ) ) {
		// Serialize the form elements
		jQuery.each( a, function() {
			add( this.name, this.value );
		});

	} else {
		// If traditional, encode the "old" way (the way 1.3.2 or older
		// did it), otherwise encode params recursively.
		for ( prefix in a ) {
			buildParams( prefix, a[ prefix ], traditional, add );
		}
	}

	// Return the resulting serialization
	return s.join( "&" ).replace( r20, "+" );
};

function buildParams( prefix, obj, traditional, add ) {
	var name;

	if ( jQuery.isArray( obj ) ) {
		// Serialize array item.
		jQuery.each( obj, function( i, v ) {
			if ( traditional || rbracket.test( prefix ) ) {
				// Treat each array item as a scalar.
				add( prefix, v );

			} else {
				// Item is non-scalar (array or object), encode its numeric index.
				buildParams( prefix + "[" + ( typeof v === "object" ? i : "" ) + "]", v, traditional, add );
			}
		});

	} else if ( !traditional && jQuery.type( obj ) === "object" ) {
		// Serialize object item.
		for ( name in obj ) {
			buildParams( prefix + "[" + name + "]", obj[ name ], traditional, add );
		}

	} else {
		// Serialize scalar item.
		add( prefix, obj );
	}
}
jQuery.each( ("blur focus focusin focusout load resize scroll unload click dblclick " +
	"mousedown mouseup mousemove mouseover mouseout mouseenter mouseleave " +
	"change select submit keydown keypress keyup error contextmenu").split(" "), function( i, name ) {

	// Handle event binding
	jQuery.fn[ name ] = function( data, fn ) {
		return arguments.length > 0 ?
			this.on( name, null, data, fn ) :
			this.trigger( name );
	};
});

jQuery.fn.hover = function( fnOver, fnOut ) {
	return this.mouseenter( fnOver ).mouseleave( fnOut || fnOver );
};
var
	// Document location
	ajaxLocParts,
	ajaxLocation,
	ajax_nonce = jQuery.now(),

	ajax_rquery = /\?/,
	rhash = /#.*$/,
	rts = /([?&])_=[^&]*/,
	rheaders = /^(.*?):[ \t]*([^\r\n]*)\r?$/mg, // IE leaves an \r character at EOL
	// #7653, #8125, #8152: local protocol detection
	rlocalProtocol = /^(?:about|app|app-storage|.+-extension|file|res|widget):$/,
	rnoContent = /^(?:GET|HEAD)$/,
	rprotocol = /^\/\//,
	rurl = /^([\w.+-]+:)(?:\/\/([^\/?#:]*)(?::(\d+)|)|)/,

	// Keep a copy of the old load method
	_load = jQuery.fn.load,

	/* Prefilters
	 * 1) They are useful to introduce custom dataTypes (see ajax/jsonp.js for an example)
	 * 2) These are called:
	 *    - BEFORE asking for a transport
	 *    - AFTER param serialization (s.data is a string if s.processData is true)
	 * 3) key is the dataType
	 * 4) the catchall symbol "*" can be used
	 * 5) execution will start with transport dataType and THEN continue down to "*" if needed
	 */
	prefilters = {},

	/* Transports bindings
	 * 1) key is the dataType
	 * 2) the catchall symbol "*" can be used
	 * 3) selection will start with transport dataType and THEN go to "*" if needed
	 */
	transports = {},

	// Avoid comment-prolog char sequence (#10098); must appease lint and evade compression
	allTypes = "*/".concat("*");

// #8138, IE may throw an exception when accessing
// a field from window.location if document.domain has been set
try {
	ajaxLocation = location.href;
} catch( e ) {
	// Use the href attribute of an A element
	// since IE will modify it given document.location
	ajaxLocation = document.createElement( "a" );
	ajaxLocation.href = "";
	ajaxLocation = ajaxLocation.href;
}

// Segment location into parts
ajaxLocParts = rurl.exec( ajaxLocation.toLowerCase() ) || [];

// Base "constructor" for jQuery.ajaxPrefilter and jQuery.ajaxTransport
function addToPrefiltersOrTransports( structure ) {

	// dataTypeExpression is optional and defaults to "*"
	return function( dataTypeExpression, func ) {

		if ( typeof dataTypeExpression !== "string" ) {
			func = dataTypeExpression;
			dataTypeExpression = "*";
		}

		var dataType,
			i = 0,
			dataTypes = dataTypeExpression.toLowerCase().match( core_rnotwhite ) || [];

		if ( jQuery.isFunction( func ) ) {
			// For each dataType in the dataTypeExpression
			while ( (dataType = dataTypes[i++]) ) {
				// Prepend if requested
				if ( dataType[0] === "+" ) {
					dataType = dataType.slice( 1 ) || "*";
					(structure[ dataType ] = structure[ dataType ] || []).unshift( func );

				// Otherwise append
				} else {
					(structure[ dataType ] = structure[ dataType ] || []).push( func );
				}
			}
		}
	};
}

// Base inspection function for prefilters and transports
function inspectPrefiltersOrTransports( structure, options, originalOptions, jqXHR ) {

	var inspected = {},
		seekingTransport = ( structure === transports );

	function inspect( dataType ) {
		var selected;
		inspected[ dataType ] = true;
		jQuery.each( structure[ dataType ] || [], function( _, prefilterOrFactory ) {
			var dataTypeOrTransport = prefilterOrFactory( options, originalOptions, jqXHR );
			if( typeof dataTypeOrTransport === "string" && !seekingTransport && !inspected[ dataTypeOrTransport ] ) {
				options.dataTypes.unshift( dataTypeOrTransport );
				inspect( dataTypeOrTransport );
				return false;
			} else if ( seekingTransport ) {
				return !( selected = dataTypeOrTransport );
			}
		});
		return selected;
	}

	return inspect( options.dataTypes[ 0 ] ) || !inspected[ "*" ] && inspect( "*" );
}

// A special extend for ajax options
// that takes "flat" options (not to be deep extended)
// Fixes #9887
function ajaxExtend( target, src ) {
	var deep, key,
		flatOptions = jQuery.ajaxSettings.flatOptions || {};

	for ( key in src ) {
		if ( src[ key ] !== undefined ) {
			( flatOptions[ key ] ? target : ( deep || (deep = {}) ) )[ key ] = src[ key ];
		}
	}
	if ( deep ) {
		jQuery.extend( true, target, deep );
	}

	return target;
}

jQuery.fn.load = function( url, params, callback ) {
	if ( typeof url !== "string" && _load ) {
		return _load.apply( this, arguments );
	}

	var selector, response, type,
		self = this,
		off = url.indexOf(" ");

	if ( off >= 0 ) {
		selector = url.slice( off, url.length );
		url = url.slice( 0, off );
	}

	// If it's a function
	if ( jQuery.isFunction( params ) ) {

		// We assume that it's the callback
		callback = params;
		params = undefined;

	// Otherwise, build a param string
	} else if ( params && typeof params === "object" ) {
		type = "POST";
	}

	// If we have elements to modify, make the request
	if ( self.length > 0 ) {
		jQuery.ajax({
			url: url,

			// if "type" variable is undefined, then "GET" method will be used
			type: type,
			dataType: "html",
			data: params
		}).done(function( responseText ) {

			// Save response for use in complete callback
			response = arguments;

			self.html( selector ?

				// If a selector was specified, locate the right elements in a dummy div
				// Exclude scripts to avoid IE 'Permission Denied' errors
				jQuery("<div>").append( jQuery.parseHTML( responseText ) ).find( selector ) :

				// Otherwise use the full result
				responseText );

		}).complete( callback && function( jqXHR, status ) {
			self.each( callback, response || [ jqXHR.responseText, status, jqXHR ] );
		});
	}

	return this;
};

// Attach a bunch of functions for handling common AJAX events
jQuery.each( [ "ajaxStart", "ajaxStop", "ajaxComplete", "ajaxError", "ajaxSuccess", "ajaxSend" ], function( i, type ){
	jQuery.fn[ type ] = function( fn ){
		return this.on( type, fn );
	};
});

jQuery.each( [ "get", "post" ], function( i, method ) {
	jQuery[ method ] = function( url, data, callback, type ) {
		// shift arguments if data argument was omitted
		if ( jQuery.isFunction( data ) ) {
			type = type || callback;
			callback = data;
			data = undefined;
		}

		return jQuery.ajax({
			url: url,
			type: method,
			dataType: type,
			data: data,
			success: callback
		});
	};
});

jQuery.extend({

	// Counter for holding the number of active queries
	active: 0,

	// Last-Modified header cache for next request
	lastModified: {},
	etag: {},

	ajaxSettings: {
		url: ajaxLocation,
		type: "GET",
		isLocal: rlocalProtocol.test( ajaxLocParts[ 1 ] ),
		global: true,
		processData: true,
		async: true,
		contentType: "application/x-www-form-urlencoded; charset=UTF-8",
		/*
		timeout: 0,
		data: null,
		dataType: null,
		username: null,
		password: null,
		cache: null,
		throws: false,
		traditional: false,
		headers: {},
		*/

		accepts: {
			"*": allTypes,
			text: "text/plain",
			html: "text/html",
			xml: "application/xml, text/xml",
			json: "application/json, text/javascript"
		},

		contents: {
			xml: /xml/,
			html: /html/,
			json: /json/
		},

		responseFields: {
			xml: "responseXML",
			text: "responseText"
		},

		// Data converters
		// Keys separate source (or catchall "*") and destination types with a single space
		converters: {

			// Convert anything to text
			"* text": window.String,

			// Text to html (true = no transformation)
			"text html": true,

			// Evaluate text as a json expression
			"text json": jQuery.parseJSON,

			// Parse text as xml
			"text xml": jQuery.parseXML
		},

		// For options that shouldn't be deep extended:
		// you can add your own custom options here if
		// and when you create one that shouldn't be
		// deep extended (see ajaxExtend)
		flatOptions: {
			url: true,
			context: true
		}
	},

	// Creates a full fledged settings object into target
	// with both ajaxSettings and settings fields.
	// If target is omitted, writes into ajaxSettings.
	ajaxSetup: function( target, settings ) {
		return settings ?

			// Building a settings object
			ajaxExtend( ajaxExtend( target, jQuery.ajaxSettings ), settings ) :

			// Extending ajaxSettings
			ajaxExtend( jQuery.ajaxSettings, target );
	},

	ajaxPrefilter: addToPrefiltersOrTransports( prefilters ),
	ajaxTransport: addToPrefiltersOrTransports( transports ),

	// Main method
	ajax: function( url, options ) {

		// If url is an object, simulate pre-1.5 signature
		if ( typeof url === "object" ) {
			options = url;
			url = undefined;
		}

		// Force options to be an object
		options = options || {};

		var // Cross-domain detection vars
			parts,
			// Loop variable
			i,
			// URL without anti-cache param
			cacheURL,
			// Response headers as string
			responseHeadersString,
			// timeout handle
			timeoutTimer,

			// To know if global events are to be dispatched
			fireGlobals,

			transport,
			// Response headers
			responseHeaders,
			// Create the final options object
			s = jQuery.ajaxSetup( {}, options ),
			// Callbacks context
			callbackContext = s.context || s,
			// Context for global events is callbackContext if it is a DOM node or jQuery collection
			globalEventContext = s.context && ( callbackContext.nodeType || callbackContext.jquery ) ?
				jQuery( callbackContext ) :
				jQuery.event,
			// Deferreds
			deferred = jQuery.Deferred(),
			completeDeferred = jQuery.Callbacks("once memory"),
			// Status-dependent callbacks
			statusCode = s.statusCode || {},
			// Headers (they are sent all at once)
			requestHeaders = {},
			requestHeadersNames = {},
			// The jqXHR state
			state = 0,
			// Default abort message
			strAbort = "canceled",
			// Fake xhr
			jqXHR = {
				readyState: 0,

				// Builds headers hashtable if needed
				getResponseHeader: function( key ) {
					var match;
					if ( state === 2 ) {
						if ( !responseHeaders ) {
							responseHeaders = {};
							while ( (match = rheaders.exec( responseHeadersString )) ) {
								responseHeaders[ match[1].toLowerCase() ] = match[ 2 ];
							}
						}
						match = responseHeaders[ key.toLowerCase() ];
					}
					return match == null ? null : match;
				},

				// Raw string
				getAllResponseHeaders: function() {
					return state === 2 ? responseHeadersString : null;
				},

				// Caches the header
				setRequestHeader: function( name, value ) {
					var lname = name.toLowerCase();
					if ( !state ) {
						name = requestHeadersNames[ lname ] = requestHeadersNames[ lname ] || name;
						requestHeaders[ name ] = value;
					}
					return this;
				},

				// Overrides response content-type header
				overrideMimeType: function( type ) {
					if ( !state ) {
						s.mimeType = type;
					}
					return this;
				},

				// Status-dependent callbacks
				statusCode: function( map ) {
					var code;
					if ( map ) {
						if ( state < 2 ) {
							for ( code in map ) {
								// Lazy-add the new callback in a way that preserves old ones
								statusCode[ code ] = [ statusCode[ code ], map[ code ] ];
							}
						} else {
							// Execute the appropriate callbacks
							jqXHR.always( map[ jqXHR.status ] );
						}
					}
					return this;
				},

				// Cancel the request
				abort: function( statusText ) {
					var finalText = statusText || strAbort;
					if ( transport ) {
						transport.abort( finalText );
					}
					done( 0, finalText );
					return this;
				}
			};

		// Attach deferreds
		deferred.promise( jqXHR ).complete = completeDeferred.add;
		jqXHR.success = jqXHR.done;
		jqXHR.error = jqXHR.fail;

		// Remove hash character (#7531: and string promotion)
		// Add protocol if not provided (#5866: IE7 issue with protocol-less urls)
		// Handle falsy url in the settings object (#10093: consistency with old signature)
		// We also use the url parameter if available
		s.url = ( ( url || s.url || ajaxLocation ) + "" ).replace( rhash, "" ).replace( rprotocol, ajaxLocParts[ 1 ] + "//" );

		// Alias method option to type as per ticket #12004
		s.type = options.method || options.type || s.method || s.type;

		// Extract dataTypes list
		s.dataTypes = jQuery.trim( s.dataType || "*" ).toLowerCase().match( core_rnotwhite ) || [""];

		// A cross-domain request is in order when we have a protocol:host:port mismatch
		if ( s.crossDomain == null ) {
			parts = rurl.exec( s.url.toLowerCase() );
			s.crossDomain = !!( parts &&
				( parts[ 1 ] !== ajaxLocParts[ 1 ] || parts[ 2 ] !== ajaxLocParts[ 2 ] ||
					( parts[ 3 ] || ( parts[ 1 ] === "http:" ? 80 : 443 ) ) !=
						( ajaxLocParts[ 3 ] || ( ajaxLocParts[ 1 ] === "http:" ? 80 : 443 ) ) )
			);
		}

		// Convert data if not already a string
		if ( s.data && s.processData && typeof s.data !== "string" ) {
			s.data = jQuery.param( s.data, s.traditional );
		}

		// Apply prefilters
		inspectPrefiltersOrTransports( prefilters, s, options, jqXHR );

		// If request was aborted inside a prefilter, stop there
		if ( state === 2 ) {
			return jqXHR;
		}

		// We can fire global events as of now if asked to
		fireGlobals = s.global;

		// Watch for a new set of requests
		if ( fireGlobals && jQuery.active++ === 0 ) {
			jQuery.event.trigger("ajaxStart");
		}

		// Uppercase the type
		s.type = s.type.toUpperCase();

		// Determine if request has content
		s.hasContent = !rnoContent.test( s.type );

		// Save the URL in case we're toying with the If-Modified-Since
		// and/or If-None-Match header later on
		cacheURL = s.url;

		// More options handling for requests with no content
		if ( !s.hasContent ) {

			// If data is available, append data to url
			if ( s.data ) {
				cacheURL = ( s.url += ( ajax_rquery.test( cacheURL ) ? "&" : "?" ) + s.data );
				// #9682: remove data so that it's not used in an eventual retry
				delete s.data;
			}

			// Add anti-cache in url if needed
			if ( s.cache === false ) {
				s.url = rts.test( cacheURL ) ?

					// If there is already a '_' parameter, set its value
					cacheURL.replace( rts, "$1_=" + ajax_nonce++ ) :

					// Otherwise add one to the end
					cacheURL + ( ajax_rquery.test( cacheURL ) ? "&" : "?" ) + "_=" + ajax_nonce++;
			}
		}

		// Set the If-Modified-Since and/or If-None-Match header, if in ifModified mode.
		if ( s.ifModified ) {
			if ( jQuery.lastModified[ cacheURL ] ) {
				jqXHR.setRequestHeader( "If-Modified-Since", jQuery.lastModified[ cacheURL ] );
			}
			if ( jQuery.etag[ cacheURL ] ) {
				jqXHR.setRequestHeader( "If-None-Match", jQuery.etag[ cacheURL ] );
			}
		}

		// Set the correct header, if data is being sent
		if ( s.data && s.hasContent && s.contentType !== false || options.contentType ) {
			jqXHR.setRequestHeader( "Content-Type", s.contentType );
		}

		// Set the Accepts header for the server, depending on the dataType
		jqXHR.setRequestHeader(
			"Accept",
			s.dataTypes[ 0 ] && s.accepts[ s.dataTypes[0] ] ?
				s.accepts[ s.dataTypes[0] ] + ( s.dataTypes[ 0 ] !== "*" ? ", " + allTypes + "; q=0.01" : "" ) :
				s.accepts[ "*" ]
		);

		// Check for headers option
		for ( i in s.headers ) {
			jqXHR.setRequestHeader( i, s.headers[ i ] );
		}

		// Allow custom headers/mimetypes and early abort
		if ( s.beforeSend && ( s.beforeSend.call( callbackContext, jqXHR, s ) === false || state === 2 ) ) {
			// Abort if not done already and return
			return jqXHR.abort();
		}

		// aborting is no longer a cancellation
		strAbort = "abort";

		// Install callbacks on deferreds
		for ( i in { success: 1, error: 1, complete: 1 } ) {
			jqXHR[ i ]( s[ i ] );
		}

		// Get transport
		transport = inspectPrefiltersOrTransports( transports, s, options, jqXHR );

		// If no transport, we auto-abort
		if ( !transport ) {
			done( -1, "No Transport" );
		} else {
			jqXHR.readyState = 1;

			// Send global event
			if ( fireGlobals ) {
				globalEventContext.trigger( "ajaxSend", [ jqXHR, s ] );
			}
			// Timeout
			if ( s.async && s.timeout > 0 ) {
				timeoutTimer = setTimeout(function() {
					jqXHR.abort("timeout");
				}, s.timeout );
			}

			try {
				state = 1;
				transport.send( requestHeaders, done );
			} catch ( e ) {
				// Propagate exception as error if not done
				if ( state < 2 ) {
					done( -1, e );
				// Simply rethrow otherwise
				} else {
					throw e;
				}
			}
		}

		// Callback for when everything is done
		function done( status, nativeStatusText, responses, headers ) {
			var isSuccess, success, error, response, modified,
				statusText = nativeStatusText;

			// Called once
			if ( state === 2 ) {
				return;
			}

			// State is "done" now
			state = 2;

			// Clear timeout if it exists
			if ( timeoutTimer ) {
				clearTimeout( timeoutTimer );
			}

			// Dereference transport for early garbage collection
			// (no matter how long the jqXHR object will be used)
			transport = undefined;

			// Cache response headers
			responseHeadersString = headers || "";

			// Set readyState
			jqXHR.readyState = status > 0 ? 4 : 0;

			// Get response data
			if ( responses ) {
				response = ajaxHandleResponses( s, jqXHR, responses );
			}

			// If successful, handle type chaining
			if ( status >= 200 && status < 300 || status === 304 ) {

				// Set the If-Modified-Since and/or If-None-Match header, if in ifModified mode.
				if ( s.ifModified ) {
					modified = jqXHR.getResponseHeader("Last-Modified");
					if ( modified ) {
						jQuery.lastModified[ cacheURL ] = modified;
					}
					modified = jqXHR.getResponseHeader("etag");
					if ( modified ) {
						jQuery.etag[ cacheURL ] = modified;
					}
				}

				// if no content
				if ( status === 204 ) {
					isSuccess = true;
					statusText = "nocontent";

				// if not modified
				} else if ( status === 304 ) {
					isSuccess = true;
					statusText = "notmodified";

				// If we have data, let's convert it
				} else {
					isSuccess = ajaxConvert( s, response );
					statusText = isSuccess.state;
					success = isSuccess.data;
					error = isSuccess.error;
					isSuccess = !error;
				}
			} else {
				// We extract error from statusText
				// then normalize statusText and status for non-aborts
				error = statusText;
				if ( status || !statusText ) {
					statusText = "error";
					if ( status < 0 ) {
						status = 0;
					}
				}
			}

			// Set data for the fake xhr object
			jqXHR.status = status;
			jqXHR.statusText = ( nativeStatusText || statusText ) + "";

			// Success/Error
			if ( isSuccess ) {
				deferred.resolveWith( callbackContext, [ success, statusText, jqXHR ] );
			} else {
				deferred.rejectWith( callbackContext, [ jqXHR, statusText, error ] );
			}

			// Status-dependent callbacks
			jqXHR.statusCode( statusCode );
			statusCode = undefined;

			if ( fireGlobals ) {
				globalEventContext.trigger( isSuccess ? "ajaxSuccess" : "ajaxError",
					[ jqXHR, s, isSuccess ? success : error ] );
			}

			// Complete
			completeDeferred.fireWith( callbackContext, [ jqXHR, statusText ] );

			if ( fireGlobals ) {
				globalEventContext.trigger( "ajaxComplete", [ jqXHR, s ] );
				// Handle the global AJAX counter
				if ( !( --jQuery.active ) ) {
					jQuery.event.trigger("ajaxStop");
				}
			}
		}

		return jqXHR;
	},

	getScript: function( url, callback ) {
		return jQuery.get( url, undefined, callback, "script" );
	},

	getJSON: function( url, data, callback ) {
		return jQuery.get( url, data, callback, "json" );
	}
});

/* Handles responses to an ajax request:
 * - sets all responseXXX fields accordingly
 * - finds the right dataType (mediates between content-type and expected dataType)
 * - returns the corresponding response
 */
function ajaxHandleResponses( s, jqXHR, responses ) {
	var firstDataType, ct, finalDataType, type,
		contents = s.contents,
		dataTypes = s.dataTypes,
		responseFields = s.responseFields;

	// Fill responseXXX fields
	for ( type in responseFields ) {
		if ( type in responses ) {
			jqXHR[ responseFields[type] ] = responses[ type ];
		}
	}

	// Remove auto dataType and get content-type in the process
	while( dataTypes[ 0 ] === "*" ) {
		dataTypes.shift();
		if ( ct === undefined ) {
			ct = s.mimeType || jqXHR.getResponseHeader("Content-Type");
		}
	}

	// Check if we're dealing with a known content-type
	if ( ct ) {
		for ( type in contents ) {
			if ( contents[ type ] && contents[ type ].test( ct ) ) {
				dataTypes.unshift( type );
				break;
			}
		}
	}

	// Check to see if we have a response for the expected dataType
	if ( dataTypes[ 0 ] in responses ) {
		finalDataType = dataTypes[ 0 ];
	} else {
		// Try convertible dataTypes
		for ( type in responses ) {
			if ( !dataTypes[ 0 ] || s.converters[ type + " " + dataTypes[0] ] ) {
				finalDataType = type;
				break;
			}
			if ( !firstDataType ) {
				firstDataType = type;
			}
		}
		// Or just use first one
		finalDataType = finalDataType || firstDataType;
	}

	// If we found a dataType
	// We add the dataType to the list if needed
	// and return the corresponding response
	if ( finalDataType ) {
		if ( finalDataType !== dataTypes[ 0 ] ) {
			dataTypes.unshift( finalDataType );
		}
		return responses[ finalDataType ];
	}
}

// Chain conversions given the request and the original response
function ajaxConvert( s, response ) {
	var conv2, current, conv, tmp,
		converters = {},
		i = 0,
		// Work with a copy of dataTypes in case we need to modify it for conversion
		dataTypes = s.dataTypes.slice(),
		prev = dataTypes[ 0 ];

	// Apply the dataFilter if provided
	if ( s.dataFilter ) {
		response = s.dataFilter( response, s.dataType );
	}

	// Create converters map with lowercased keys
	if ( dataTypes[ 1 ] ) {
		for ( conv in s.converters ) {
			converters[ conv.toLowerCase() ] = s.converters[ conv ];
		}
	}

	// Convert to each sequential dataType, tolerating list modification
	for ( ; (current = dataTypes[++i]); ) {

		// There's only work to do if current dataType is non-auto
		if ( current !== "*" ) {

			// Convert response if prev dataType is non-auto and differs from current
			if ( prev !== "*" && prev !== current ) {

				// Seek a direct converter
				conv = converters[ prev + " " + current ] || converters[ "* " + current ];

				// If none found, seek a pair
				if ( !conv ) {
					for ( conv2 in converters ) {

						// If conv2 outputs current
						tmp = conv2.split(" ");
						if ( tmp[ 1 ] === current ) {

							// If prev can be converted to accepted input
							conv = converters[ prev + " " + tmp[ 0 ] ] ||
								converters[ "* " + tmp[ 0 ] ];
							if ( conv ) {
								// Condense equivalence converters
								if ( conv === true ) {
									conv = converters[ conv2 ];

								// Otherwise, insert the intermediate dataType
								} else if ( converters[ conv2 ] !== true ) {
									current = tmp[ 0 ];
									dataTypes.splice( i--, 0, current );
								}

								break;
							}
						}
					}
				}

				// Apply converter (if not an equivalence)
				if ( conv !== true ) {

					// Unless errors are allowed to bubble, catch and return them
					if ( conv && s["throws"] ) {
						response = conv( response );
					} else {
						try {
							response = conv( response );
						} catch ( e ) {
							return { state: "parsererror", error: conv ? e : "No conversion from " + prev + " to " + current };
						}
					}
				}
			}

			// Update prev for next iteration
			prev = current;
		}
	}

	return { state: "success", data: response };
}
// Install script dataType
jQuery.ajaxSetup({
	accepts: {
		script: "text/javascript, application/javascript, application/ecmascript, application/x-ecmascript"
	},
	contents: {
		script: /(?:java|ecma)script/
	},
	converters: {
		"text script": function( text ) {
			jQuery.globalEval( text );
			return text;
		}
	}
});

// Handle cache's special case and global
jQuery.ajaxPrefilter( "script", function( s ) {
	if ( s.cache === undefined ) {
		s.cache = false;
	}
	if ( s.crossDomain ) {
		s.type = "GET";
		s.global = false;
	}
});

// Bind script tag hack transport
jQuery.ajaxTransport( "script", function(s) {

	// This transport only deals with cross domain requests
	if ( s.crossDomain ) {

		var script,
			head = document.head || jQuery("head")[0] || document.documentElement;

		return {

			send: function( _, callback ) {

				script = document.createElement("script");

				script.async = true;

				if ( s.scriptCharset ) {
					script.charset = s.scriptCharset;
				}

				script.src = s.url;

				// Attach handlers for all browsers
				script.onload = script.onreadystatechange = function( _, isAbort ) {

					if ( isAbort || !script.readyState || /loaded|complete/.test( script.readyState ) ) {

						// Handle memory leak in IE
						script.onload = script.onreadystatechange = null;

						// Remove the script
						if ( script.parentNode ) {
							script.parentNode.removeChild( script );
						}

						// Dereference the script
						script = null;

						// Callback if not abort
						if ( !isAbort ) {
							callback( 200, "success" );
						}
					}
				};

				// Circumvent IE6 bugs with base elements (#2709 and #4378) by prepending
				// Use native DOM manipulation to avoid our domManip AJAX trickery
				head.insertBefore( script, head.firstChild );
			},

			abort: function() {
				if ( script ) {
					script.onload( undefined, true );
				}
			}
		};
	}
});
var oldCallbacks = [],
	rjsonp = /(=)\?(?=&|$)|\?\?/;

// Default jsonp settings
jQuery.ajaxSetup({
	jsonp: "callback",
	jsonpCallback: function() {
		var callback = oldCallbacks.pop() || ( jQuery.expando + "_" + ( ajax_nonce++ ) );
		this[ callback ] = true;
		return callback;
	}
});

// Detect, normalize options and install callbacks for jsonp requests
jQuery.ajaxPrefilter( "json jsonp", function( s, originalSettings, jqXHR ) {

	var callbackName, overwritten, responseContainer,
		jsonProp = s.jsonp !== false && ( rjsonp.test( s.url ) ?
			"url" :
			typeof s.data === "string" && !( s.contentType || "" ).indexOf("application/x-www-form-urlencoded") && rjsonp.test( s.data ) && "data"
		);

	// Handle iff the expected data type is "jsonp" or we have a parameter to set
	if ( jsonProp || s.dataTypes[ 0 ] === "jsonp" ) {

		// Get callback name, remembering preexisting value associated with it
		callbackName = s.jsonpCallback = jQuery.isFunction( s.jsonpCallback ) ?
			s.jsonpCallback() :
			s.jsonpCallback;

		// Insert callback into url or form data
		if ( jsonProp ) {
			s[ jsonProp ] = s[ jsonProp ].replace( rjsonp, "$1" + callbackName );
		} else if ( s.jsonp !== false ) {
			s.url += ( ajax_rquery.test( s.url ) ? "&" : "?" ) + s.jsonp + "=" + callbackName;
		}

		// Use data converter to retrieve json after script execution
		s.converters["script json"] = function() {
			if ( !responseContainer ) {
				jQuery.error( callbackName + " was not called" );
			}
			return responseContainer[ 0 ];
		};

		// force json dataType
		s.dataTypes[ 0 ] = "json";

		// Install callback
		overwritten = window[ callbackName ];
		window[ callbackName ] = function() {
			responseContainer = arguments;
		};

		// Clean-up function (fires after converters)
		jqXHR.always(function() {
			// Restore preexisting value
			window[ callbackName ] = overwritten;

			// Save back as free
			if ( s[ callbackName ] ) {
				// make sure that re-using the options doesn't screw things around
				s.jsonpCallback = originalSettings.jsonpCallback;

				// save the callback name for future use
				oldCallbacks.push( callbackName );
			}

			// Call if it was a function and we have a response
			if ( responseContainer && jQuery.isFunction( overwritten ) ) {
				overwritten( responseContainer[ 0 ] );
			}

			responseContainer = overwritten = undefined;
		});

		// Delegate to script
		return "script";
	}
});
var xhrCallbacks, xhrSupported,
	xhrId = 0,
	// #5280: Internet Explorer will keep connections alive if we don't abort on unload
	xhrOnUnloadAbort = window.ActiveXObject && function() {
		// Abort all pending requests
		var key;
		for ( key in xhrCallbacks ) {
			xhrCallbacks[ key ]( undefined, true );
		}
	};

// Functions to create xhrs
function createStandardXHR() {
	try {
		return new window.XMLHttpRequest();
	} catch( e ) {}
}

function createActiveXHR() {
	try {
		return new window.ActiveXObject("Microsoft.XMLHTTP");
	} catch( e ) {}
}

// Create the request object
// (This is still attached to ajaxSettings for backward compatibility)
jQuery.ajaxSettings.xhr = window.ActiveXObject ?
	/* Microsoft failed to properly
	 * implement the XMLHttpRequest in IE7 (can't request local files),
	 * so we use the ActiveXObject when it is available
	 * Additionally XMLHttpRequest can be disabled in IE7/IE8 so
	 * we need a fallback.
	 */
	function() {
		return !this.isLocal && createStandardXHR() || createActiveXHR();
	} :
	// For all other browsers, use the standard XMLHttpRequest object
	createStandardXHR;

// Determine support properties
xhrSupported = jQuery.ajaxSettings.xhr();
jQuery.support.cors = !!xhrSupported && ( "withCredentials" in xhrSupported );
xhrSupported = jQuery.support.ajax = !!xhrSupported;

// Create transport if the browser can provide an xhr
if ( xhrSupported ) {

	jQuery.ajaxTransport(function( s ) {
		// Cross domain only allowed if supported through XMLHttpRequest
		if ( !s.crossDomain || jQuery.support.cors ) {

			var callback;

			return {
				send: function( headers, complete ) {

					// Get a new xhr
					var handle, i,
						xhr = s.xhr();

					// Open the socket
					// Passing null username, generates a login popup on Opera (#2865)
					if ( s.username ) {
						xhr.open( s.type, s.url, s.async, s.username, s.password );
					} else {
						xhr.open( s.type, s.url, s.async );
					}

					// Apply custom fields if provided
					if ( s.xhrFields ) {
						for ( i in s.xhrFields ) {
							xhr[ i ] = s.xhrFields[ i ];
						}
					}

					// Override mime type if needed
					if ( s.mimeType && xhr.overrideMimeType ) {
						xhr.overrideMimeType( s.mimeType );
					}

					// X-Requested-With header
					// For cross-domain requests, seeing as conditions for a preflight are
					// akin to a jigsaw puzzle, we simply never set it to be sure.
					// (it can always be set on a per-request basis or even using ajaxSetup)
					// For same-domain requests, won't change header if already provided.
					if ( !s.crossDomain && !headers["X-Requested-With"] ) {
						headers["X-Requested-With"] = "XMLHttpRequest";
					}

					// Need an extra try/catch for cross domain requests in Firefox 3
					try {
						for ( i in headers ) {
							xhr.setRequestHeader( i, headers[ i ] );
						}
					} catch( err ) {}

					// Do send the request
					// This may raise an exception which is actually
					// handled in jQuery.ajax (so no try/catch here)
					xhr.send( ( s.hasContent && s.data ) || null );

					// Listener
					callback = function( _, isAbort ) {
						var status, responseHeaders, statusText, responses;

						// Firefox throws exceptions when accessing properties
						// of an xhr when a network error occurred
						// http://helpful.knobs-dials.com/index.php/Component_returned_failure_code:_0x80040111_(NS_ERROR_NOT_AVAILABLE)
						try {

							// Was never called and is aborted or complete
							if ( callback && ( isAbort || xhr.readyState === 4 ) ) {

								// Only called once
								callback = undefined;

								// Do not keep as active anymore
								if ( handle ) {
									xhr.onreadystatechange = jQuery.noop;
									if ( xhrOnUnloadAbort ) {
										delete xhrCallbacks[ handle ];
									}
								}

								// If it's an abort
								if ( isAbort ) {
									// Abort it manually if needed
									if ( xhr.readyState !== 4 ) {
										xhr.abort();
									}
								} else {
									responses = {};
									status = xhr.status;
									responseHeaders = xhr.getAllResponseHeaders();

									// When requesting binary data, IE6-9 will throw an exception
									// on any attempt to access responseText (#11426)
									if ( typeof xhr.responseText === "string" ) {
										responses.text = xhr.responseText;
									}

									// Firefox throws an exception when accessing
									// statusText for faulty cross-domain requests
									try {
										statusText = xhr.statusText;
									} catch( e ) {
										// We normalize with Webkit giving an empty statusText
										statusText = "";
									}

									// Filter status for non standard behaviors

									// If the request is local and we have data: assume a success
									// (success with no data won't get notified, that's the best we
									// can do given current implementations)
									if ( !status && s.isLocal && !s.crossDomain ) {
										status = responses.text ? 200 : 404;
									// IE - #1450: sometimes returns 1223 when it should be 204
									} else if ( status === 1223 ) {
										status = 204;
									}
								}
							}
						} catch( firefoxAccessException ) {
							if ( !isAbort ) {
								complete( -1, firefoxAccessException );
							}
						}

						// Call complete if needed
						if ( responses ) {
							complete( status, statusText, responses, responseHeaders );
						}
					};

					if ( !s.async ) {
						// if we're in sync mode we fire the callback
						callback();
					} else if ( xhr.readyState === 4 ) {
						// (IE6 & IE7) if it's in cache and has been
						// retrieved directly we need to fire the callback
						setTimeout( callback );
					} else {
						handle = ++xhrId;
						if ( xhrOnUnloadAbort ) {
							// Create the active xhrs callbacks list if needed
							// and attach the unload handler
							if ( !xhrCallbacks ) {
								xhrCallbacks = {};
								jQuery( window ).unload( xhrOnUnloadAbort );
							}
							// Add to list of active xhrs callbacks
							xhrCallbacks[ handle ] = callback;
						}
						xhr.onreadystatechange = callback;
					}
				},

				abort: function() {
					if ( callback ) {
						callback( undefined, true );
					}
				}
			};
		}
	});
}
var fxNow, timerId,
	rfxtypes = /^(?:toggle|show|hide)$/,
	rfxnum = new RegExp( "^(?:([+-])=|)(" + core_pnum + ")([a-z%]*)$", "i" ),
	rrun = /queueHooks$/,
	animationPrefilters = [ defaultPrefilter ],
	tweeners = {
		"*": [function( prop, value ) {
			var end, unit,
				tween = this.createTween( prop, value ),
				parts = rfxnum.exec( value ),
				target = tween.cur(),
				start = +target || 0,
				scale = 1,
				maxIterations = 20;

			if ( parts ) {
				end = +parts[2];
				unit = parts[3] || ( jQuery.cssNumber[ prop ] ? "" : "px" );

				// We need to compute starting value
				if ( unit !== "px" && start ) {
					// Iteratively approximate from a nonzero starting point
					// Prefer the current property, because this process will be trivial if it uses the same units
					// Fallback to end or a simple constant
					start = jQuery.css( tween.elem, prop, true ) || end || 1;

					do {
						// If previous iteration zeroed out, double until we get *something*
						// Use a string for doubling factor so we don't accidentally see scale as unchanged below
						scale = scale || ".5";

						// Adjust and apply
						start = start / scale;
						jQuery.style( tween.elem, prop, start + unit );

					// Update scale, tolerating zero or NaN from tween.cur()
					// And breaking the loop if scale is unchanged or perfect, or if we've just had enough
					} while ( scale !== (scale = tween.cur() / target) && scale !== 1 && --maxIterations );
				}

				tween.unit = unit;
				tween.start = start;
				// If a +=/-= token was provided, we're doing a relative animation
				tween.end = parts[1] ? start + ( parts[1] + 1 ) * end : end;
			}
			return tween;
		}]
	};

// Animations created synchronously will run synchronously
function createFxNow() {
	setTimeout(function() {
		fxNow = undefined;
	});
	return ( fxNow = jQuery.now() );
}

function createTweens( animation, props ) {
	jQuery.each( props, function( prop, value ) {
		var collection = ( tweeners[ prop ] || [] ).concat( tweeners[ "*" ] ),
			index = 0,
			length = collection.length;
		for ( ; index < length; index++ ) {
			if ( collection[ index ].call( animation, prop, value ) ) {

				// we're done with this property
				return;
			}
		}
	});
}

function Animation( elem, properties, options ) {
	var result,
		stopped,
		index = 0,
		length = animationPrefilters.length,
		deferred = jQuery.Deferred().always( function() {
			// don't match elem in the :animated selector
			delete tick.elem;
		}),
		tick = function() {
			if ( stopped ) {
				return false;
			}
			var currentTime = fxNow || createFxNow(),
				remaining = Math.max( 0, animation.startTime + animation.duration - currentTime ),
				// archaic crash bug won't allow us to use 1 - ( 0.5 || 0 ) (#12497)
				temp = remaining / animation.duration || 0,
				percent = 1 - temp,
				index = 0,
				length = animation.tweens.length;

			for ( ; index < length ; index++ ) {
				animation.tweens[ index ].run( percent );
			}

			deferred.notifyWith( elem, [ animation, percent, remaining ]);

			if ( percent < 1 && length ) {
				return remaining;
			} else {
				deferred.resolveWith( elem, [ animation ] );
				return false;
			}
		},
		animation = deferred.promise({
			elem: elem,
			props: jQuery.extend( {}, properties ),
			opts: jQuery.extend( true, { specialEasing: {} }, options ),
			originalProperties: properties,
			originalOptions: options,
			startTime: fxNow || createFxNow(),
			duration: options.duration,
			tweens: [],
			createTween: function( prop, end ) {
				var tween = jQuery.Tween( elem, animation.opts, prop, end,
						animation.opts.specialEasing[ prop ] || animation.opts.easing );
				animation.tweens.push( tween );
				return tween;
			},
			stop: function( gotoEnd ) {
				var index = 0,
					// if we are going to the end, we want to run all the tweens
					// otherwise we skip this part
					length = gotoEnd ? animation.tweens.length : 0;
				if ( stopped ) {
					return this;
				}
				stopped = true;
				for ( ; index < length ; index++ ) {
					animation.tweens[ index ].run( 1 );
				}

				// resolve when we played the last frame
				// otherwise, reject
				if ( gotoEnd ) {
					deferred.resolveWith( elem, [ animation, gotoEnd ] );
				} else {
					deferred.rejectWith( elem, [ animation, gotoEnd ] );
				}
				return this;
			}
		}),
		props = animation.props;

	propFilter( props, animation.opts.specialEasing );

	for ( ; index < length ; index++ ) {
		result = animationPrefilters[ index ].call( animation, elem, props, animation.opts );
		if ( result ) {
			return result;
		}
	}

	createTweens( animation, props );

	if ( jQuery.isFunction( animation.opts.start ) ) {
		animation.opts.start.call( elem, animation );
	}

	jQuery.fx.timer(
		jQuery.extend( tick, {
			elem: elem,
			anim: animation,
			queue: animation.opts.queue
		})
	);

	// attach callbacks from options
	return animation.progress( animation.opts.progress )
		.done( animation.opts.done, animation.opts.complete )
		.fail( animation.opts.fail )
		.always( animation.opts.always );
}

function propFilter( props, specialEasing ) {
	var value, name, index, easing, hooks;

	// camelCase, specialEasing and expand cssHook pass
	for ( index in props ) {
		name = jQuery.camelCase( index );
		easing = specialEasing[ name ];
		value = props[ index ];
		if ( jQuery.isArray( value ) ) {
			easing = value[ 1 ];
			value = props[ index ] = value[ 0 ];
		}

		if ( index !== name ) {
			props[ name ] = value;
			delete props[ index ];
		}

		hooks = jQuery.cssHooks[ name ];
		if ( hooks && "expand" in hooks ) {
			value = hooks.expand( value );
			delete props[ name ];

			// not quite $.extend, this wont overwrite keys already present.
			// also - reusing 'index' from above because we have the correct "name"
			for ( index in value ) {
				if ( !( index in props ) ) {
					props[ index ] = value[ index ];
					specialEasing[ index ] = easing;
				}
			}
		} else {
			specialEasing[ name ] = easing;
		}
	}
}

jQuery.Animation = jQuery.extend( Animation, {

	tweener: function( props, callback ) {
		if ( jQuery.isFunction( props ) ) {
			callback = props;
			props = [ "*" ];
		} else {
			props = props.split(" ");
		}

		var prop,
			index = 0,
			length = props.length;

		for ( ; index < length ; index++ ) {
			prop = props[ index ];
			tweeners[ prop ] = tweeners[ prop ] || [];
			tweeners[ prop ].unshift( callback );
		}
	},

	prefilter: function( callback, prepend ) {
		if ( prepend ) {
			animationPrefilters.unshift( callback );
		} else {
			animationPrefilters.push( callback );
		}
	}
});

function defaultPrefilter( elem, props, opts ) {
	/*jshint validthis:true */
	var prop, index, length,
		value, dataShow, toggle,
		tween, hooks, oldfire,
		anim = this,
		style = elem.style,
		orig = {},
		handled = [],
		hidden = elem.nodeType && isHidden( elem );

	// handle queue: false promises
	if ( !opts.queue ) {
		hooks = jQuery._queueHooks( elem, "fx" );
		if ( hooks.unqueued == null ) {
			hooks.unqueued = 0;
			oldfire = hooks.empty.fire;
			hooks.empty.fire = function() {
				if ( !hooks.unqueued ) {
					oldfire();
				}
			};
		}
		hooks.unqueued++;

		anim.always(function() {
			// doing this makes sure that the complete handler will be called
			// before this completes
			anim.always(function() {
				hooks.unqueued--;
				if ( !jQuery.queue( elem, "fx" ).length ) {
					hooks.empty.fire();
				}
			});
		});
	}

	// height/width overflow pass
	if ( elem.nodeType === 1 && ( "height" in props || "width" in props ) ) {
		// Make sure that nothing sneaks out
		// Record all 3 overflow attributes because IE does not
		// change the overflow attribute when overflowX and
		// overflowY are set to the same value
		opts.overflow = [ style.overflow, style.overflowX, style.overflowY ];

		// Set display property to inline-block for height/width
		// animations on inline elements that are having width/height animated
		if ( jQuery.css( elem, "display" ) === "inline" &&
				jQuery.css( elem, "float" ) === "none" ) {

			// inline-level elements accept inline-block;
			// block-level elements need to be inline with layout
			if ( !jQuery.support.inlineBlockNeedsLayout || css_defaultDisplay( elem.nodeName ) === "inline" ) {
				style.display = "inline-block";

			} else {
				style.zoom = 1;
			}
		}
	}

	if ( opts.overflow ) {
		style.overflow = "hidden";
		if ( !jQuery.support.shrinkWrapBlocks ) {
			anim.always(function() {
				style.overflow = opts.overflow[ 0 ];
				style.overflowX = opts.overflow[ 1 ];
				style.overflowY = opts.overflow[ 2 ];
			});
		}
	}


	// show/hide pass
	for ( index in props ) {
		value = props[ index ];
		if ( rfxtypes.exec( value ) ) {
			delete props[ index ];
			toggle = toggle || value === "toggle";
			if ( value === ( hidden ? "hide" : "show" ) ) {
				continue;
			}
			handled.push( index );
		}
	}

	length = handled.length;
	if ( length ) {
		dataShow = jQuery._data( elem, "fxshow" ) || jQuery._data( elem, "fxshow", {} );
		if ( "hidden" in dataShow ) {
			hidden = dataShow.hidden;
		}

		// store state if its toggle - enables .stop().toggle() to "reverse"
		if ( toggle ) {
			dataShow.hidden = !hidden;
		}
		if ( hidden ) {
			jQuery( elem ).show();
		} else {
			anim.done(function() {
				jQuery( elem ).hide();
			});
		}
		anim.done(function() {
			var prop;
			jQuery._removeData( elem, "fxshow" );
			for ( prop in orig ) {
				jQuery.style( elem, prop, orig[ prop ] );
			}
		});
		for ( index = 0 ; index < length ; index++ ) {
			prop = handled[ index ];
			tween = anim.createTween( prop, hidden ? dataShow[ prop ] : 0 );
			orig[ prop ] = dataShow[ prop ] || jQuery.style( elem, prop );

			if ( !( prop in dataShow ) ) {
				dataShow[ prop ] = tween.start;
				if ( hidden ) {
					tween.end = tween.start;
					tween.start = prop === "width" || prop === "height" ? 1 : 0;
				}
			}
		}
	}
}

function Tween( elem, options, prop, end, easing ) {
	return new Tween.prototype.init( elem, options, prop, end, easing );
}
jQuery.Tween = Tween;

Tween.prototype = {
	constructor: Tween,
	init: function( elem, options, prop, end, easing, unit ) {
		this.elem = elem;
		this.prop = prop;
		this.easing = easing || "swing";
		this.options = options;
		this.start = this.now = this.cur();
		this.end = end;
		this.unit = unit || ( jQuery.cssNumber[ prop ] ? "" : "px" );
	},
	cur: function() {
		var hooks = Tween.propHooks[ this.prop ];

		return hooks && hooks.get ?
			hooks.get( this ) :
			Tween.propHooks._default.get( this );
	},
	run: function( percent ) {
		var eased,
			hooks = Tween.propHooks[ this.prop ];

		if ( this.options.duration ) {
			this.pos = eased = jQuery.easing[ this.easing ](
				percent, this.options.duration * percent, 0, 1, this.options.duration
			);
		} else {
			this.pos = eased = percent;
		}
		this.now = ( this.end - this.start ) * eased + this.start;

		if ( this.options.step ) {
			this.options.step.call( this.elem, this.now, this );
		}

		if ( hooks && hooks.set ) {
			hooks.set( this );
		} else {
			Tween.propHooks._default.set( this );
		}
		return this;
	}
};

Tween.prototype.init.prototype = Tween.prototype;

Tween.propHooks = {
	_default: {
		get: function( tween ) {
			var result;

			if ( tween.elem[ tween.prop ] != null &&
				(!tween.elem.style || tween.elem.style[ tween.prop ] == null) ) {
				return tween.elem[ tween.prop ];
			}

			// passing an empty string as a 3rd parameter to .css will automatically
			// attempt a parseFloat and fallback to a string if the parse fails
			// so, simple values such as "10px" are parsed to Float.
			// complex values such as "rotate(1rad)" are returned as is.
			result = jQuery.css( tween.elem, tween.prop, "" );
			// Empty strings, null, undefined and "auto" are converted to 0.
			return !result || result === "auto" ? 0 : result;
		},
		set: function( tween ) {
			// use step hook for back compat - use cssHook if its there - use .style if its
			// available and use plain properties where available
			if ( jQuery.fx.step[ tween.prop ] ) {
				jQuery.fx.step[ tween.prop ]( tween );
			} else if ( tween.elem.style && ( tween.elem.style[ jQuery.cssProps[ tween.prop ] ] != null || jQuery.cssHooks[ tween.prop ] ) ) {
				jQuery.style( tween.elem, tween.prop, tween.now + tween.unit );
			} else {
				tween.elem[ tween.prop ] = tween.now;
			}
		}
	}
};

// Remove in 2.0 - this supports IE8's panic based approach
// to setting things on disconnected nodes

Tween.propHooks.scrollTop = Tween.propHooks.scrollLeft = {
	set: function( tween ) {
		if ( tween.elem.nodeType && tween.elem.parentNode ) {
			tween.elem[ tween.prop ] = tween.now;
		}
	}
};

jQuery.each([ "toggle", "show", "hide" ], function( i, name ) {
	var cssFn = jQuery.fn[ name ];
	jQuery.fn[ name ] = function( speed, easing, callback ) {
		return speed == null || typeof speed === "boolean" ?
			cssFn.apply( this, arguments ) :
			this.animate( genFx( name, true ), speed, easing, callback );
	};
});

jQuery.fn.extend({
	fadeTo: function( speed, to, easing, callback ) {

		// show any hidden elements after setting opacity to 0
		return this.filter( isHidden ).css( "opacity", 0 ).show()

			// animate to the value specified
			.end().animate({ opacity: to }, speed, easing, callback );
	},
	animate: function( prop, speed, easing, callback ) {
		var empty = jQuery.isEmptyObject( prop ),
			optall = jQuery.speed( speed, easing, callback ),
			doAnimation = function() {
				// Operate on a copy of prop so per-property easing won't be lost
				var anim = Animation( this, jQuery.extend( {}, prop ), optall );
				doAnimation.finish = function() {
					anim.stop( true );
				};
				// Empty animations, or finishing resolves immediately
				if ( empty || jQuery._data( this, "finish" ) ) {
					anim.stop( true );
				}
			};
			doAnimation.finish = doAnimation;

		return empty || optall.queue === false ?
			this.each( doAnimation ) :
			this.queue( optall.queue, doAnimation );
	},
	stop: function( type, clearQueue, gotoEnd ) {
		var stopQueue = function( hooks ) {
			var stop = hooks.stop;
			delete hooks.stop;
			stop( gotoEnd );
		};

		if ( typeof type !== "string" ) {
			gotoEnd = clearQueue;
			clearQueue = type;
			type = undefined;
		}
		if ( clearQueue && type !== false ) {
			this.queue( type || "fx", [] );
		}

		return this.each(function() {
			var dequeue = true,
				index = type != null && type + "queueHooks",
				timers = jQuery.timers,
				data = jQuery._data( this );

			if ( index ) {
				if ( data[ index ] && data[ index ].stop ) {
					stopQueue( data[ index ] );
				}
			} else {
				for ( index in data ) {
					if ( data[ index ] && data[ index ].stop && rrun.test( index ) ) {
						stopQueue( data[ index ] );
					}
				}
			}

			for ( index = timers.length; index--; ) {
				if ( timers[ index ].elem === this && (type == null || timers[ index ].queue === type) ) {
					timers[ index ].anim.stop( gotoEnd );
					dequeue = false;
					timers.splice( index, 1 );
				}
			}

			// start the next in the queue if the last step wasn't forced
			// timers currently will call their complete callbacks, which will dequeue
			// but only if they were gotoEnd
			if ( dequeue || !gotoEnd ) {
				jQuery.dequeue( this, type );
			}
		});
	},
	finish: function( type ) {
		if ( type !== false ) {
			type = type || "fx";
		}
		return this.each(function() {
			var index,
				data = jQuery._data( this ),
				queue = data[ type + "queue" ],
				hooks = data[ type + "queueHooks" ],
				timers = jQuery.timers,
				length = queue ? queue.length : 0;

			// enable finishing flag on private data
			data.finish = true;

			// empty the queue first
			jQuery.queue( this, type, [] );

			if ( hooks && hooks.cur && hooks.cur.finish ) {
				hooks.cur.finish.call( this );
			}

			// look for any active animations, and finish them
			for ( index = timers.length; index--; ) {
				if ( timers[ index ].elem === this && timers[ index ].queue === type ) {
					timers[ index ].anim.stop( true );
					timers.splice( index, 1 );
				}
			}

			// look for any animations in the old queue and finish them
			for ( index = 0; index < length; index++ ) {
				if ( queue[ index ] && queue[ index ].finish ) {
					queue[ index ].finish.call( this );
				}
			}

			// turn off finishing flag
			delete data.finish;
		});
	}
});

// Generate parameters to create a standard animation
function genFx( type, includeWidth ) {
	var which,
		attrs = { height: type },
		i = 0;

	// if we include width, step value is 1 to do all cssExpand values,
	// if we don't include width, step value is 2 to skip over Left and Right
	includeWidth = includeWidth? 1 : 0;
	for( ; i < 4 ; i += 2 - includeWidth ) {
		which = cssExpand[ i ];
		attrs[ "margin" + which ] = attrs[ "padding" + which ] = type;
	}

	if ( includeWidth ) {
		attrs.opacity = attrs.width = type;
	}

	return attrs;
}

// Generate shortcuts for custom animations
jQuery.each({
	slideDown: genFx("show"),
	slideUp: genFx("hide"),
	slideToggle: genFx("toggle"),
	fadeIn: { opacity: "show" },
	fadeOut: { opacity: "hide" },
	fadeToggle: { opacity: "toggle" }
}, function( name, props ) {
	jQuery.fn[ name ] = function( speed, easing, callback ) {
		return this.animate( props, speed, easing, callback );
	};
});

jQuery.speed = function( speed, easing, fn ) {
	var opt = speed && typeof speed === "object" ? jQuery.extend( {}, speed ) : {
		complete: fn || !fn && easing ||
			jQuery.isFunction( speed ) && speed,
		duration: speed,
		easing: fn && easing || easing && !jQuery.isFunction( easing ) && easing
	};

	opt.duration = jQuery.fx.off ? 0 : typeof opt.duration === "number" ? opt.duration :
		opt.duration in jQuery.fx.speeds ? jQuery.fx.speeds[ opt.duration ] : jQuery.fx.speeds._default;

	// normalize opt.queue - true/undefined/null -> "fx"
	if ( opt.queue == null || opt.queue === true ) {
		opt.queue = "fx";
	}

	// Queueing
	opt.old = opt.complete;

	opt.complete = function() {
		if ( jQuery.isFunction( opt.old ) ) {
			opt.old.call( this );
		}

		if ( opt.queue ) {
			jQuery.dequeue( this, opt.queue );
		}
	};

	return opt;
};

jQuery.easing = {
	linear: function( p ) {
		return p;
	},
	swing: function( p ) {
		return 0.5 - Math.cos( p*Math.PI ) / 2;
	}
};

jQuery.timers = [];
jQuery.fx = Tween.prototype.init;
jQuery.fx.tick = function() {
	var timer,
		timers = jQuery.timers,
		i = 0;

	fxNow = jQuery.now();

	for ( ; i < timers.length; i++ ) {
		timer = timers[ i ];
		// Checks the timer has not already been removed
		if ( !timer() && timers[ i ] === timer ) {
			timers.splice( i--, 1 );
		}
	}

	if ( !timers.length ) {
		jQuery.fx.stop();
	}
	fxNow = undefined;
};

jQuery.fx.timer = function( timer ) {
	if ( timer() && jQuery.timers.push( timer ) ) {
		jQuery.fx.start();
	}
};

jQuery.fx.interval = 13;

jQuery.fx.start = function() {
	if ( !timerId ) {
		timerId = setInterval( jQuery.fx.tick, jQuery.fx.interval );
	}
};

jQuery.fx.stop = function() {
	clearInterval( timerId );
	timerId = null;
};

jQuery.fx.speeds = {
	slow: 600,
	fast: 200,
	// Default speed
	_default: 400
};

// Back Compat <1.8 extension point
jQuery.fx.step = {};

if ( jQuery.expr && jQuery.expr.filters ) {
	jQuery.expr.filters.animated = function( elem ) {
		return jQuery.grep(jQuery.timers, function( fn ) {
			return elem === fn.elem;
		}).length;
	};
}
jQuery.fn.offset = function( options ) {
	if ( arguments.length ) {
		return options === undefined ?
			this :
			this.each(function( i ) {
				jQuery.offset.setOffset( this, options, i );
			});
	}

	var docElem, win,
		box = { top: 0, left: 0 },
		elem = this[ 0 ],
		doc = elem && elem.ownerDocument;

	if ( !doc ) {
		return;
	}

	docElem = doc.documentElement;

	// Make sure it's not a disconnected DOM node
	if ( !jQuery.contains( docElem, elem ) ) {
		return box;
	}

	// If we don't have gBCR, just use 0,0 rather than error
	// BlackBerry 5, iOS 3 (original iPhone)
	if ( typeof elem.getBoundingClientRect !== core_strundefined ) {
		box = elem.getBoundingClientRect();
	}
	win = getWindow( doc );
	return {
		top: box.top  + ( win.pageYOffset || docElem.scrollTop )  - ( docElem.clientTop  || 0 ),
		left: box.left + ( win.pageXOffset || docElem.scrollLeft ) - ( docElem.clientLeft || 0 )
	};
};

jQuery.offset = {

	setOffset: function( elem, options, i ) {
		var position = jQuery.css( elem, "position" );

		// set position first, in-case top/left are set even on static elem
		if ( position === "static" ) {
			elem.style.position = "relative";
		}

		var curElem = jQuery( elem ),
			curOffset = curElem.offset(),
			curCSSTop = jQuery.css( elem, "top" ),
			curCSSLeft = jQuery.css( elem, "left" ),
			calculatePosition = ( position === "absolute" || position === "fixed" ) && jQuery.inArray("auto", [curCSSTop, curCSSLeft]) > -1,
			props = {}, curPosition = {}, curTop, curLeft;

		// need to be able to calculate position if either top or left is auto and position is either absolute or fixed
		if ( calculatePosition ) {
			curPosition = curElem.position();
			curTop = curPosition.top;
			curLeft = curPosition.left;
		} else {
			curTop = parseFloat( curCSSTop ) || 0;
			curLeft = parseFloat( curCSSLeft ) || 0;
		}

		if ( jQuery.isFunction( options ) ) {
			options = options.call( elem, i, curOffset );
		}

		if ( options.top != null ) {
			props.top = ( options.top - curOffset.top ) + curTop;
		}
		if ( options.left != null ) {
			props.left = ( options.left - curOffset.left ) + curLeft;
		}

		if ( "using" in options ) {
			options.using.call( elem, props );
		} else {
			curElem.css( props );
		}
	}
};


jQuery.fn.extend({

	position: function() {
		if ( !this[ 0 ] ) {
			return;
		}

		var offsetParent, offset,
			parentOffset = { top: 0, left: 0 },
			elem = this[ 0 ];

		// fixed elements are offset from window (parentOffset = {top:0, left: 0}, because it is it's only offset parent
		if ( jQuery.css( elem, "position" ) === "fixed" ) {
			// we assume that getBoundingClientRect is available when computed position is fixed
			offset = elem.getBoundingClientRect();
		} else {
			// Get *real* offsetParent
			offsetParent = this.offsetParent();

			// Get correct offsets
			offset = this.offset();
			if ( !jQuery.nodeName( offsetParent[ 0 ], "html" ) ) {
				parentOffset = offsetParent.offset();
			}

			// Add offsetParent borders
			parentOffset.top  += jQuery.css( offsetParent[ 0 ], "borderTopWidth", true );
			parentOffset.left += jQuery.css( offsetParent[ 0 ], "borderLeftWidth", true );
		}

		// Subtract parent offsets and element margins
		// note: when an element has margin: auto the offsetLeft and marginLeft
		// are the same in Safari causing offset.left to incorrectly be 0
		return {
			top:  offset.top  - parentOffset.top - jQuery.css( elem, "marginTop", true ),
			left: offset.left - parentOffset.left - jQuery.css( elem, "marginLeft", true)
		};
	},

	offsetParent: function() {
		return this.map(function() {
			var offsetParent = this.offsetParent || document.documentElement;
			while ( offsetParent && ( !jQuery.nodeName( offsetParent, "html" ) && jQuery.css( offsetParent, "position") === "static" ) ) {
				offsetParent = offsetParent.offsetParent;
			}
			return offsetParent || document.documentElement;
		});
	}
});


// Create scrollLeft and scrollTop methods
jQuery.each( {scrollLeft: "pageXOffset", scrollTop: "pageYOffset"}, function( method, prop ) {
	var top = /Y/.test( prop );

	jQuery.fn[ method ] = function( val ) {
		return jQuery.access( this, function( elem, method, val ) {
			var win = getWindow( elem );

			if ( val === undefined ) {
				return win ? (prop in win) ? win[ prop ] :
					win.document.documentElement[ method ] :
					elem[ method ];
			}

			if ( win ) {
				win.scrollTo(
					!top ? val : jQuery( win ).scrollLeft(),
					top ? val : jQuery( win ).scrollTop()
				);

			} else {
				elem[ method ] = val;
			}
		}, method, val, arguments.length, null );
	};
});

function getWindow( elem ) {
	return jQuery.isWindow( elem ) ?
		elem :
		elem.nodeType === 9 ?
			elem.defaultView || elem.parentWindow :
			false;
}
// Create innerHeight, innerWidth, height, width, outerHeight and outerWidth methods
jQuery.each( { Height: "height", Width: "width" }, function( name, type ) {
	jQuery.each( { padding: "inner" + name, content: type, "": "outer" + name }, function( defaultExtra, funcName ) {
		// margin is only for outerHeight, outerWidth
		jQuery.fn[ funcName ] = function( margin, value ) {
			var chainable = arguments.length && ( defaultExtra || typeof margin !== "boolean" ),
				extra = defaultExtra || ( margin === true || value === true ? "margin" : "border" );

			return jQuery.access( this, function( elem, type, value ) {
				var doc;

				if ( jQuery.isWindow( elem ) ) {
					// As of 5/8/2012 this will yield incorrect results for Mobile Safari, but there
					// isn't a whole lot we can do. See pull request at this URL for discussion:
					// https://github.com/jquery/jquery/pull/764
					return elem.document.documentElement[ "client" + name ];
				}

				// Get document width or height
				if ( elem.nodeType === 9 ) {
					doc = elem.documentElement;

					// Either scroll[Width/Height] or offset[Width/Height] or client[Width/Height], whichever is greatest
					// unfortunately, this causes bug #3838 in IE6/8 only, but there is currently no good, small way to fix it.
					return Math.max(
						elem.body[ "scroll" + name ], doc[ "scroll" + name ],
						elem.body[ "offset" + name ], doc[ "offset" + name ],
						doc[ "client" + name ]
					);
				}

				return value === undefined ?
					// Get width or height on the element, requesting but not forcing parseFloat
					jQuery.css( elem, type, extra ) :

					// Set width or height on the element
					jQuery.style( elem, type, value, extra );
			}, type, chainable ? margin : undefined, chainable, null );
		};
	});
});
// Limit scope pollution from any deprecated API
// (function() {

// })();
// Expose jQuery to the global object
window.jQuery = window.$ = jQuery;

// Expose jQuery as an AMD module, but only for AMD loaders that
// understand the issues with loading multiple versions of jQuery
// in a page that all might call define(). The loader will indicate
// they have special allowances for multiple jQuery versions by
// specifying define.amd.jQuery = true. Register as a named module,
// since jQuery can be concatenated with other files that may use define,
// but not use a proper concatenation script that understands anonymous
// AMD modules. A named AMD is safest and most robust way to register.
// Lowercase jquery is used because AMD module names are derived from
// file names, and jQuery is normally delivered in a lowercase file name.
// Do this after creating the global so that if an AMD module wants to call
// noConflict to hide this version of jQuery, it will work.
if ( typeof define === "function" && define.amd && define.amd.jQuery ) {
	define( "jquery", [], function () { return jQuery; } );
}

})( window );
MD5 = function(s){function L(k,d){return(k<<d)|(k>>>(32-d))}function K(G,k){var I,d,F,H,x;F=(G&2147483648);H=(k&2147483648);I=(G&1073741824);d=(k&1073741824);x=(G&1073741823)+(k&1073741823);if(I&d){return(x^2147483648^F^H)}if(I|d){if(x&1073741824){return(x^3221225472^F^H)}else{return(x^1073741824^F^H)}}else{return(x^F^H)}}function r(d,F,k){return(d&F)|((~d)&k)}function q(d,F,k){return(d&k)|(F&(~k))}function p(d,F,k){return(d^F^k)}function n(d,F,k){return(F^(d|(~k)))}function u(G,F,aa,Z,k,H,I){G=K(G,K(K(r(F,aa,Z),k),I));return K(L(G,H),F)}function f(G,F,aa,Z,k,H,I){G=K(G,K(K(q(F,aa,Z),k),I));return K(L(G,H),F)}function D(G,F,aa,Z,k,H,I){G=K(G,K(K(p(F,aa,Z),k),I));return K(L(G,H),F)}function t(G,F,aa,Z,k,H,I){G=K(G,K(K(n(F,aa,Z),k),I));return K(L(G,H),F)}function e(G){var Z;var F=G.length;var x=F+8;var k=(x-(x%64))/64;var I=(k+1)*16;var aa=Array(I-1);var d=0;var H=0;while(H<F){Z=(H-(H%4))/4;d=(H%4)*8;aa[Z]=(aa[Z]| (G.charCodeAt(H)<<d));H++}Z=(H-(H%4))/4;d=(H%4)*8;aa[Z]=aa[Z]|(128<<d);aa[I-2]=F<<3;aa[I-1]=F>>>29;return aa}function B(x){var k="",F="",G,d;for(d=0;d<=3;d++){G=(x>>>(d*8))&255;F="0"+G.toString(16);k=k+F.substr(F.length-2,2)}return k}function J(k){k=k.replace(/rn/g,"n");var d="";for(var F=0;F<k.length;F++){var x=k.charCodeAt(F);if(x<128){d+=String.fromCharCode(x)}else{if((x>127)&&(x<2048)){d+=String.fromCharCode((x>>6)|192);d+=String.fromCharCode((x&63)|128)}else{d+=String.fromCharCode((x>>12)|224);d+=String.fromCharCode(((x>>6)&63)|128);d+=String.fromCharCode((x&63)|128)}}}return d}var C=Array();var P,h,E,v,g,Y,X,W,V;var S=7,Q=12,N=17,M=22;var A=5,z=9,y=14,w=20;var o=4,m=11,l=16,j=23;var U=6,T=10,R=15,O=21;s=J(s);C=e(s);Y=1732584193;X=4023233417;W=2562383102;V=271733878;for(P=0;P<C.length;P+=16){h=Y;E=X;v=W;g=V;Y=u(Y,X,W,V,C[P+0],S,3614090360);V=u(V,Y,X,W,C[P+1],Q,3905402710);W=u(W,V,Y,X,C[P+2],N,606105819);X=u(X,W,V,Y,C[P+3],M,3250441966);Y=u(Y,X,W,V,C[P+4],S,4118548399);V=u(V,Y,X,W,C[P+5],Q,1200080426);W=u(W,V,Y,X,C[P+6],N,2821735955);X=u(X,W,V,Y,C[P+7],M,4249261313);Y=u(Y,X,W,V,C[P+8],S,1770035416);V=u(V,Y,X,W,C[P+9],Q,2336552879);W=u(W,V,Y,X,C[P+10],N,4294925233);X=u(X,W,V,Y,C[P+11],M,2304563134);Y=u(Y,X,W,V,C[P+12],S,1804603682);V=u(V,Y,X,W,C[P+13],Q,4254626195);W=u(W,V,Y,X,C[P+14],N,2792965006);X=u(X,W,V,Y,C[P+15],M,1236535329);Y=f(Y,X,W,V,C[P+1],A,4129170786);V=f(V,Y,X,W,C[P+6],z,3225465664);W=f(W,V,Y,X,C[P+11],y,643717713);X=f(X,W,V,Y,C[P+0],w,3921069994);Y=f(Y,X,W,V,C[P+5],A,3593408605);V=f(V,Y,X,W,C[P+10],z,38016083);W=f(W,V,Y,X,C[P+15],y,3634488961);X=f(X,W,V,Y,C[P+4],w,3889429448);Y=f(Y,X,W,V,C[P+9],A,568446438);V=f(V,Y,X,W,C[P+14],z,3275163606);W=f(W,V,Y,X,C[P+3],y,4107603335);X=f(X,W,V,Y,C[P+8],w,1163531501);Y=f(Y,X,W,V,C[P+13],A,2850285829);V=f(V,Y,X,W,C[P+2],z,4243563512);W=f(W,V,Y,X,C[P+7],y,1735328473);X=f(X,W,V,Y,C[P+12],w,2368359562);Y=D(Y,X,W,V,C[P+5],o,4294588738);V=D(V,Y,X,W,C[P+8],m,2272392833);W=D(W,V,Y,X,C[P+11],l,1839030562);X=D(X,W,V,Y,C[P+14],j,4259657740);Y=D(Y,X,W,V,C[P+1],o,2763975236);V=D(V,Y,X,W,C[P+4],m,1272893353);W=D(W,V,Y,X,C[P+7],l,4139469664);X=D(X,W,V,Y,C[P+10],j,3200236656);Y=D(Y,X,W,V,C[P+13],o,681279174);V=D(V,Y,X,W,C[P+0],m,3936430074);W=D(W,V,Y,X,C[P+3],l,3572445317);X=D(X,W,V,Y,C[P+6],j,76029189);Y=D(Y,X,W,V,C[P+9],o,3654602809);V=D(V,Y,X,W,C[P+12],m,3873151461);W=D(W,V,Y,X,C[P+15],l,530742520);X=D(X,W,V,Y,C[P+2],j,3299628645);Y=t(Y,X,W,V,C[P+0],U,4096336452);V=t(V,Y,X,W,C[P+7],T,1126891415);W=t(W,V,Y,X,C[P+14],R,2878612391);X=t(X,W,V,Y,C[P+5],O,4237533241);Y=t(Y,X,W,V,C[P+12],U,1700485571);V=t(V,Y,X,W,C[P+3],T,2399980690);W=t(W,V,Y,X,C[P+10],R,4293915773);X=t(X,W,V,Y,C[P+1],O,2240044497);Y=t(Y,X,W,V,C[P+8],U,1873313359);V=t(V,Y,X,W,C[P+15],T,4264355552);W=t(W,V,Y,X,C[P+6],R,2734768916);X=t(X,W,V,Y,C[P+13],O,1309151649);Y=t(Y,X,W,V,C[P+4],U,4149444226);V=t(V,Y,X,W,C[P+11],T,3174756917);W=t(W,V,Y,X,C[P+2],R,718787259);X=t(X,W,V,Y,C[P+9],O,3951481745);Y=K(Y,h);X=K(X,E);W=K(W,v);V=K(V,g)}var i=B(Y)+B(X)+B(W)+B(V);return i.toLowerCase()};
/*
 * Copyright (c) 2009 Simo Kinnunen.
 * Licensed under the MIT license.
 *
 * @version 1.09i
 */

var Cufon=(function(){var m=function(){return m.replace.apply(null,arguments)};var x=m.DOM={ready:(function(){var C=false,E={loaded:1,complete:1};var B=[],D=function(){if(C){return}C=true;for(var F;F=B.shift();F()){}};if(document.addEventListener){document.addEventListener("DOMContentLoaded",D,false);window.addEventListener("pageshow",D,false)}if(!window.opera&&document.readyState){(function(){E[document.readyState]?D():setTimeout(arguments.callee,10)})()}if(document.readyState&&document.createStyleSheet){(function(){try{document.body.doScroll("left");D()}catch(F){setTimeout(arguments.callee,1)}})()}q(window,"load",D);return function(F){if(!arguments.length){D()}else{C?F():B.push(F)}}})(),root:function(){return document.documentElement||document.body}};var n=m.CSS={Size:function(C,B){this.value=parseFloat(C);this.unit=String(C).match(/[a-z%]*$/)[0]||"px";this.convert=function(D){return D/B*this.value};this.convertFrom=function(D){return D/this.value*B};this.toString=function(){return this.value+this.unit}},addClass:function(C,B){var D=C.className;C.className=D+(D&&" ")+B;return C},color:j(function(C){var B={};B.color=C.replace(/^rgba\((.*?),\s*([\d.]+)\)/,function(E,D,F){B.opacity=parseFloat(F);return"rgb("+D+")"});return B}),fontStretch:j(function(B){if(typeof B=="number"){return B}if(/%$/.test(B)){return parseFloat(B)/100}return{"ultra-condensed":0.5,"extra-condensed":0.625,condensed:0.75,"semi-condensed":0.875,"semi-expanded":1.125,expanded:1.25,"extra-expanded":1.5,"ultra-expanded":2}[B]||1}),getStyle:function(C){var B=document.defaultView;if(B&&B.getComputedStyle){return new a(B.getComputedStyle(C,null))}if(C.currentStyle){return new a(C.currentStyle)}return new a(C.style)},gradient:j(function(F){var G={id:F,type:F.match(/^-([a-z]+)-gradient\(/)[1],stops:[]},C=F.substr(F.indexOf("(")).match(/([\d.]+=)?(#[a-f0-9]+|[a-z]+\(.*?\)|[a-z]+)/ig);for(var E=0,B=C.length,D;E<B;++E){D=C[E].split("=",2).reverse();G.stops.push([D[1]||E/(B-1),D[0]])}return G}),quotedList:j(function(E){var D=[],C=/\s*((["'])([\s\S]*?[^\\])\2|[^,]+)\s*/g,B;while(B=C.exec(E)){D.push(B[3]||B[1])}return D}),recognizesMedia:j(function(G){var E=document.createElement("style"),D,C,B;E.type="text/css";E.media=G;try{E.appendChild(document.createTextNode("/**/"))}catch(F){}C=g("head")[0];C.insertBefore(E,C.firstChild);D=(E.sheet||E.styleSheet);B=D&&!D.disabled;C.removeChild(E);return B}),removeClass:function(D,C){var B=RegExp("(?:^|\\s+)"+C+"(?=\\s|$)","g");D.className=D.className.replace(B,"");return D},supports:function(D,C){var B=document.createElement("span").style;if(B[D]===undefined){return false}B[D]=C;return B[D]===C},textAlign:function(E,D,B,C){if(D.get("textAlign")=="right"){if(B>0){E=" "+E}}else{if(B<C-1){E+=" "}}return E},textShadow:j(function(F){if(F=="none"){return null}var E=[],G={},B,C=0;var D=/(#[a-f0-9]+|[a-z]+\(.*?\)|[a-z]+)|(-?[\d.]+[a-z%]*)|,/ig;while(B=D.exec(F)){if(B[0]==","){E.push(G);G={};C=0}else{if(B[1]){G.color=B[1]}else{G[["offX","offY","blur"][C++]]=B[2]}}}E.push(G);return E}),textTransform:(function(){var B={uppercase:function(C){return C.toUpperCase()},lowercase:function(C){return C.toLowerCase()},capitalize:function(C){return C.replace(/\b./g,function(D){return D.toUpperCase()})}};return function(E,D){var C=B[D.get("textTransform")];return C?C(E):E}})(),whiteSpace:(function(){var D={inline:1,"inline-block":1,"run-in":1};var C=/^\s+/,B=/\s+$/;return function(H,F,G,E){if(E){if(E.nodeName.toLowerCase()=="br"){H=H.replace(C,"")}}if(D[F.get("display")]){return H}if(!G.previousSibling){H=H.replace(C,"")}if(!G.nextSibling){H=H.replace(B,"")}return H}})()};n.ready=(function(){var B=!n.recognizesMedia("all"),E=false;var D=[],H=function(){B=true;for(var K;K=D.shift();K()){}};var I=g("link"),J=g("style");function C(K){return K.disabled||G(K.sheet,K.media||"screen")}function G(M,P){if(!n.recognizesMedia(P||"all")){return true}if(!M||M.disabled){return false}try{var Q=M.cssRules,O;if(Q){search:for(var L=0,K=Q.length;O=Q[L],L<K;++L){switch(O.type){case 2:break;case 3:if(!G(O.styleSheet,O.media.mediaText)){return false}break;default:break search}}}}catch(N){}return true}function F(){if(document.createStyleSheet){return true}var L,K;for(K=0;L=I[K];++K){if(L.rel.toLowerCase()=="stylesheet"&&!C(L)){return false}}for(K=0;L=J[K];++K){if(!C(L)){return false}}return true}x.ready(function(){if(!E){E=n.getStyle(document.body).isUsable()}if(B||(E&&F())){H()}else{setTimeout(arguments.callee,10)}});return function(K){if(B){K()}else{D.push(K)}}})();function s(D){var C=this.face=D.face,B={"\u0020":1,"\u00a0":1,"\u3000":1};this.glyphs=D.glyphs;this.w=D.w;this.baseSize=parseInt(C["units-per-em"],10);this.family=C["font-family"].toLowerCase();this.weight=C["font-weight"];this.style=C["font-style"]||"normal";this.viewBox=(function(){var F=C.bbox.split(/\s+/);var E={minX:parseInt(F[0],10),minY:parseInt(F[1],10),maxX:parseInt(F[2],10),maxY:parseInt(F[3],10)};E.width=E.maxX-E.minX;E.height=E.maxY-E.minY;E.toString=function(){return[this.minX,this.minY,this.width,this.height].join(" ")};return E})();this.ascent=-parseInt(C.ascent,10);this.descent=-parseInt(C.descent,10);this.height=-this.ascent+this.descent;this.spacing=function(L,N,E){var O=this.glyphs,M,K,G,P=[],F=0,J=-1,I=-1,H;while(H=L[++J]){M=O[H]||this.missingGlyph;if(!M){continue}if(K){F-=G=K[H]||0;P[I]-=G}F+=P[++I]=~~(M.w||this.w)+N+(B[H]?E:0);K=M.k}P.total=F;return P}}function f(){var C={},B={oblique:"italic",italic:"oblique"};this.add=function(D){(C[D.style]||(C[D.style]={}))[D.weight]=D};this.get=function(H,I){var G=C[H]||C[B[H]]||C.normal||C.italic||C.oblique;if(!G){return null}I={normal:400,bold:700}[I]||parseInt(I,10);if(G[I]){return G[I]}var E={1:1,99:0}[I%100],K=[],F,D;if(E===undefined){E=I>400}if(I==500){I=400}for(var J in G){if(!k(G,J)){continue}J=parseInt(J,10);if(!F||J<F){F=J}if(!D||J>D){D=J}K.push(J)}if(I<F){I=F}if(I>D){I=D}K.sort(function(M,L){return(E?(M>=I&&L>=I)?M<L:M>L:(M<=I&&L<=I)?M>L:M<L)?-1:1});return G[K[0]]}}function r(){function D(F,G){if(F.contains){return F.contains(G)}return F.compareDocumentPosition(G)&16}function B(G){var F=G.relatedTarget;if(!F||D(this,F)){return}C(this,G.type=="mouseover")}function E(F){C(this,F.type=="mouseenter")}function C(F,G){setTimeout(function(){var H=d.get(F).options;m.replace(F,G?h(H,H.hover):H,true)},10)}this.attach=function(F){if(F.onmouseenter===undefined){q(F,"mouseover",B);q(F,"mouseout",B)}else{q(F,"mouseenter",E);q(F,"mouseleave",E)}}}function u(){var C=[],D={};function B(H){var E=[],G;for(var F=0;G=H[F];++F){E[F]=C[D[G]]}return E}this.add=function(F,E){D[F]=C.push(E)-1};this.repeat=function(){var E=arguments.length?B(arguments):C,F;for(var G=0;F=E[G++];){m.replace(F[0],F[1],true)}}}function A(){var D={},B=0;function C(E){return E.cufid||(E.cufid=++B)}this.get=function(E){var F=C(E);return D[F]||(D[F]={})}}function a(B){var D={},C={};this.extend=function(E){for(var F in E){if(k(E,F)){D[F]=E[F]}}return this};this.get=function(E){return D[E]!=undefined?D[E]:B[E]};this.getSize=function(F,E){return C[F]||(C[F]=new n.Size(this.get(F),E))};this.isUsable=function(){return !!B}}function q(C,B,D){if(C.addEventListener){C.addEventListener(B,D,false)}else{if(C.attachEvent){C.attachEvent("on"+B,function(){return D.call(C,window.event)})}}}function v(C,B){var D=d.get(C);if(D.options){return C}if(B.hover&&B.hoverables[C.nodeName.toLowerCase()]){b.attach(C)}D.options=B;return C}function j(B){var C={};return function(D){if(!k(C,D)){C[D]=B.apply(null,arguments)}return C[D]}}function c(F,E){var B=n.quotedList(E.get("fontFamily").toLowerCase()),D;for(var C=0;D=B[C];++C){if(i[D]){return i[D].get(E.get("fontStyle"),E.get("fontWeight"))}}return null}function g(B){return document.getElementsByTagName(B)}function k(C,B){return C.hasOwnProperty(B)}function h(){var C={},B,F;for(var E=0,D=arguments.length;B=arguments[E],E<D;++E){for(F in B){if(k(B,F)){C[F]=B[F]}}}return C}function o(E,M,C,N,F,D){var K=document.createDocumentFragment(),H;if(M===""){return K}var L=N.separate;var I=M.split(p[L]),B=(L=="words");if(B&&t){if(/^\s/.test(M)){I.unshift("")}if(/\s$/.test(M)){I.push("")}}for(var J=0,G=I.length;J<G;++J){H=z[N.engine](E,B?n.textAlign(I[J],C,J,G):I[J],C,N,F,D,J<G-1);if(H){K.appendChild(H)}}return K}function l(D,M){var C=D.nodeName.toLowerCase();if(M.ignore[C]){return}var E=!M.textless[C];var B=n.getStyle(v(D,M)).extend(M);var F=c(D,B),G,K,I,H,L,J;if(!F){return}for(G=D.firstChild;G;G=I){K=G.nodeType;I=G.nextSibling;if(E&&K==3){if(H){H.appendData(G.data);D.removeChild(G)}else{H=G}if(I){continue}}if(H){D.replaceChild(o(F,n.whiteSpace(H.data,B,H,J),B,M,G,D),H);H=null}if(K==1){if(G.firstChild){if(G.nodeName.toLowerCase()=="cufon"){z[M.engine](F,null,B,M,G,D)}else{arguments.callee(G,M)}}J=G}}}var t=" ".split(/\s+/).length==0;var d=new A();var b=new r();var y=new u();var e=false;var z={},i={},w={autoDetect:false,engine:null,forceHitArea:false,hover:false,hoverables:{a:true},ignore:{applet:1,canvas:1,col:1,colgroup:1,head:1,iframe:1,map:1,optgroup:1,option:1,script:1,select:1,style:1,textarea:1,title:1,pre:1},printable:true,selector:(window.Sizzle||(window.jQuery&&function(B){return jQuery(B)})||(window.dojo&&dojo.query)||(window.Ext&&Ext.query)||(window.YAHOO&&YAHOO.util&&YAHOO.util.Selector&&YAHOO.util.Selector.query)||(window.$$&&function(B){return $$(B)})||(window.$&&function(B){return $(B)})||(document.querySelectorAll&&function(B){return document.querySelectorAll(B)})||g),separate:"words",textless:{dl:1,html:1,ol:1,table:1,tbody:1,thead:1,tfoot:1,tr:1,ul:1},textShadow:"none"};var p={words:/\s/.test("\u00a0")?/[^\S\u00a0]+/:/\s+/,characters:"",none:/^/};m.now=function(){x.ready();return m};m.refresh=function(){y.repeat.apply(y,arguments);return m};m.registerEngine=function(C,B){if(!B){return m}z[C]=B;return m.set("engine",C)};m.registerFont=function(D){if(!D){return m}var B=new s(D),C=B.family;if(!i[C]){i[C]=new f()}i[C].add(B);return m.set("fontFamily",'"'+C+'"')};m.replace=function(D,C,B){C=h(w,C);if(!C.engine){return m}if(!e){n.addClass(x.root(),"cufon-active cufon-loading");n.ready(function(){n.addClass(n.removeClass(x.root(),"cufon-loading"),"cufon-ready")});e=true}if(C.hover){C.forceHitArea=true}if(C.autoDetect){delete C.fontFamily}if(typeof C.textShadow=="string"){C.textShadow=n.textShadow(C.textShadow)}if(typeof C.color=="string"&&/^-/.test(C.color)){C.textGradient=n.gradient(C.color)}else{delete C.textGradient}if(!B){y.add(D,arguments)}if(D.nodeType||typeof D=="string"){D=[D]}n.ready(function(){for(var F=0,E=D.length;F<E;++F){var G=D[F];if(typeof G=="string"){m.replace(C.selector(G),C,true)}else{l(G,C)}}});return m};m.set=function(B,C){w[B]=C;return m};return m})();Cufon.registerEngine("vml",(function(){var e=document.namespaces;if(!e){return}e.add("cvml","urn:schemas-microsoft-com:vml");e=null;var b=document.createElement("cvml:shape");b.style.behavior="url(#default#VML)";if(!b.coordsize){return}b=null;var h=(document.documentMode||0)<8;document.write(('<style type="text/css">cufoncanvas{text-indent:0;}@media screen{cvml\\:shape,cvml\\:rect,cvml\\:fill,cvml\\:shadow{behavior:url(#default#VML);display:block;antialias:true;position:absolute;}cufoncanvas{position:absolute;text-align:left;}cufon{display:inline-block;position:relative;vertical-align:'+(h?"middle":"text-bottom")+";}cufon cufontext{position:absolute;left:-10000in;font-size:1px;}a cufon{cursor:pointer}}@media print{cufon cufoncanvas{display:none;}}</style>").replace(/;/g,"!important;"));function c(i,j){return a(i,/(?:em|ex|%)$|^[a-z-]+$/i.test(j)?"1em":j)}function a(l,m){if(m==="0"){return 0}if(/px$/i.test(m)){return parseFloat(m)}var k=l.style.left,j=l.runtimeStyle.left;l.runtimeStyle.left=l.currentStyle.left;l.style.left=m.replace("%","em");var i=l.style.pixelLeft;l.style.left=k;l.runtimeStyle.left=j;return i}function f(l,k,j,n){var i="computed"+n,m=k[i];if(isNaN(m)){m=k.get(n);k[i]=m=(m=="normal")?0:~~j.convertFrom(a(l,m))}return m}var g={};function d(p){var q=p.id;if(!g[q]){var n=p.stops,o=document.createElement("cvml:fill"),i=[];o.type="gradient";o.angle=180;o.focus="0";o.method="sigma";o.color=n[0][1];for(var m=1,l=n.length-1;m<l;++m){i.push(n[m][0]*100+"% "+n[m][1])}o.colors=i.join(",");o.color2=n[l][1];g[q]=o}return g[q]}return function(ac,G,Y,C,K,ad,W){var n=(G===null);if(n){G=K.alt}var I=ac.viewBox;var p=Y.computedFontSize||(Y.computedFontSize=new Cufon.CSS.Size(c(ad,Y.get("fontSize"))+"px",ac.baseSize));var y,q;if(n){y=K;q=K.firstChild}else{y=document.createElement("cufon");y.className="cufon cufon-vml";y.alt=G;q=document.createElement("cufoncanvas");y.appendChild(q);if(C.printable){var Z=document.createElement("cufontext");Z.appendChild(document.createTextNode(G));y.appendChild(Z)}if(!W){y.appendChild(document.createElement("cvml:shape"))}}var ai=y.style;var R=q.style;var l=p.convert(I.height),af=Math.ceil(l);var V=af/l;var P=V*Cufon.CSS.fontStretch(Y.get("fontStretch"));var U=I.minX,T=I.minY;R.height=af;R.top=Math.round(p.convert(T-ac.ascent));R.left=Math.round(p.convert(U));ai.height=p.convert(ac.height)+"px";var F=Y.get("color");var ag=Cufon.CSS.textTransform(G,Y).split("");var L=ac.spacing(ag,f(ad,Y,p,"letterSpacing"),f(ad,Y,p,"wordSpacing"));if(!L.length){return null}var k=L.total;var x=-U+k+(I.width-L[L.length-1]);var ah=p.convert(x*P),X=Math.round(ah);var O=x+","+I.height,m;var J="r"+O+"ns";var u=C.textGradient&&d(C.textGradient);var o=ac.glyphs,S=0;var H=C.textShadow;var ab=-1,aa=0,w;while(w=ag[++ab]){var D=o[ag[ab]]||ac.missingGlyph,v;if(!D){continue}if(n){v=q.childNodes[aa];while(v.firstChild){v.removeChild(v.firstChild)}}else{v=document.createElement("cvml:shape");q.appendChild(v)}v.stroked="f";v.coordsize=O;v.coordorigin=m=(U-S)+","+T;v.path=(D.d?"m"+D.d+"xe":"")+"m"+m+J;v.fillcolor=F;if(u){v.appendChild(u.cloneNode(false))}var ae=v.style;ae.width=X;ae.height=af;if(H){var s=H[0],r=H[1];var B=Cufon.CSS.color(s.color),z;var N=document.createElement("cvml:shadow");N.on="t";N.color=B.color;N.offset=s.offX+","+s.offY;if(r){z=Cufon.CSS.color(r.color);N.type="double";N.color2=z.color;N.offset2=r.offX+","+r.offY}N.opacity=B.opacity||(z&&z.opacity)||1;v.appendChild(N)}S+=L[aa++]}var M=v.nextSibling,t,A;if(C.forceHitArea){if(!M){M=document.createElement("cvml:rect");M.stroked="f";M.className="cufon-vml-cover";t=document.createElement("cvml:fill");t.opacity=0;M.appendChild(t);q.appendChild(M)}A=M.style;A.width=X;A.height=af}else{if(M){q.removeChild(M)}}ai.width=Math.max(Math.ceil(p.convert(k*P)),0);if(h){var Q=Y.computedYAdjust;if(Q===undefined){var E=Y.get("lineHeight");if(E=="normal"){E="1em"}else{if(!isNaN(E)){E+="em"}}Y.computedYAdjust=Q=0.5*(a(ad,E)-parseFloat(ai.height))}if(Q){ai.marginTop=Math.ceil(Q)+"px";ai.marginBottom=Q+"px"}}return y}})());Cufon.registerEngine("canvas",(function(){var b=document.createElement("canvas");if(!b||!b.getContext||!b.getContext.apply){return}b=null;var a=Cufon.CSS.supports("display","inline-block");var e=!a&&(document.compatMode=="BackCompat"||/frameset|transitional/i.test(document.doctype.publicId));var f=document.createElement("style");f.type="text/css";f.appendChild(document.createTextNode(("cufon{text-indent:0;}@media screen,projection{cufon{display:inline;display:inline-block;position:relative;vertical-align:middle;"+(e?"":"font-size:1px;line-height:1px;")+"}cufon cufontext{display:-moz-inline-box;display:inline-block;width:0;height:0;overflow:hidden;text-indent:-10000in;}"+(a?"cufon canvas{position:relative;}":"cufon canvas{position:absolute;}")+"}@media print{cufon{padding:0;}cufon canvas{display:none;}}").replace(/;/g,"!important;")));document.getElementsByTagName("head")[0].appendChild(f);function d(p,h){var n=0,m=0;var g=[],o=/([mrvxe])([^a-z]*)/g,k;generate:for(var j=0;k=o.exec(p);++j){var l=k[2].split(",");switch(k[1]){case"v":g[j]={m:"bezierCurveTo",a:[n+~~l[0],m+~~l[1],n+~~l[2],m+~~l[3],n+=~~l[4],m+=~~l[5]]};break;case"r":g[j]={m:"lineTo",a:[n+=~~l[0],m+=~~l[1]]};break;case"m":g[j]={m:"moveTo",a:[n=~~l[0],m=~~l[1]]};break;case"x":g[j]={m:"closePath"};break;case"e":break generate}h[g[j].m].apply(h,g[j].a)}return g}function c(m,k){for(var j=0,h=m.length;j<h;++j){var g=m[j];k[g.m].apply(k,g.a)}}return function(V,w,P,t,C,W){var k=(w===null);if(k){w=C.getAttribute("alt")}var A=V.viewBox;var m=P.getSize("fontSize",V.baseSize);var B=0,O=0,N=0,u=0;var z=t.textShadow,L=[];if(z){for(var U=z.length;U--;){var F=z[U];var K=m.convertFrom(parseFloat(F.offX));var I=m.convertFrom(parseFloat(F.offY));L[U]=[K,I];if(I<B){B=I}if(K>O){O=K}if(I>N){N=I}if(K<u){u=K}}}var Z=Cufon.CSS.textTransform(w,P).split("");var E=V.spacing(Z,~~m.convertFrom(parseFloat(P.get("letterSpacing"))||0),~~m.convertFrom(parseFloat(P.get("wordSpacing"))||0));if(!E.length){return null}var h=E.total;O+=A.width-E[E.length-1];u+=A.minX;var s,n;if(k){s=C;n=C.firstChild}else{s=document.createElement("cufon");s.className="cufon cufon-canvas";s.setAttribute("alt",w);n=document.createElement("canvas");s.appendChild(n);if(t.printable){var S=document.createElement("cufontext");S.appendChild(document.createTextNode(w));s.appendChild(S)}}var aa=s.style;var H=n.style;var j=m.convert(A.height);var Y=Math.ceil(j);var M=Y/j;var G=M*Cufon.CSS.fontStretch(P.get("fontStretch"));var J=h*G;var Q=Math.ceil(m.convert(J+O-u));var o=Math.ceil(m.convert(A.height-B+N));n.width=Q;n.height=o;H.width=Q+"px";H.height=o+"px";B+=A.minY;H.top=Math.round(m.convert(B-V.ascent))+"px";H.left=Math.round(m.convert(u))+"px";var r=Math.max(Math.ceil(m.convert(J)),0)+"px";if(a){aa.width=r;aa.height=m.convert(V.height)+"px"}else{aa.paddingLeft=r;aa.paddingBottom=(m.convert(V.height)-1)+"px"}var X=n.getContext("2d"),D=j/A.height;X.scale(D,D*M);X.translate(-u,-B);X.save();function T(){var x=V.glyphs,ab,l=-1,g=-1,y;X.scale(G,1);while(y=Z[++l]){var ab=x[Z[l]]||V.missingGlyph;if(!ab){continue}if(ab.d){X.beginPath();if(ab.code){c(ab.code,X)}else{ab.code=d("m"+ab.d,X)}X.fill()}X.translate(E[++g],0)}X.restore()}if(z){for(var U=z.length;U--;){var F=z[U];X.save();X.fillStyle=F.color;X.translate.apply(X,L[U]);T()}}var q=t.textGradient;if(q){var v=q.stops,p=X.createLinearGradient(0,A.minY,0,A.maxY);for(var U=0,R=v.length;U<R;++U){p.addColorStop.apply(p,v[U])}X.fillStyle=p}else{X.fillStyle=P.get("color")}T();return s}})());
/*!
 * jQuery Migrate - v1.3.0 - 2016-03-04
 * Copyright jQuery Foundation and other contributors
 */

// Wrapped for InSales

(function(module){
  if (typeof(define) == 'function' && define.amd) {
    define('jquery-migrate', ['jquery'], module);
  } else {
    module(window.jQuery);
  }
})(function( jQuery ) {
  // See http://bugs.jquery.com/ticket/13335
  // "use strict";

  jQuery.migrateVersion = "1.3.0";


  var warnedAbout = {};

  // List of warnings already given; public read only
  jQuery.migrateWarnings = [];

  // Set to true to prevent console output; migrateWarnings still maintained
  // jQuery.migrateMute = false;

  // Show a message on the console so devs know we're active
  if ( !jQuery.migrateMute && window.console && window.console.log ) {
    window.console.log("JQMIGRATE: Logging is active");
  }

  // Set to false to disable traces that appear with warnings
  if ( jQuery.migrateTrace === undefined ) {
    jQuery.migrateTrace = true;
  }

  // Forget any warnings we've already given; public
  jQuery.migrateReset = function() {
    warnedAbout = {};
    jQuery.migrateWarnings.length = 0;
  };

  function migrateWarn( msg) {
    var console = window.console;
    if ( !warnedAbout[ msg ] ) {
      warnedAbout[ msg ] = true;
      jQuery.migrateWarnings.push( msg );
      if ( console && console.warn && !jQuery.migrateMute ) {
        console.warn( "JQMIGRATE: " + msg );
        if ( jQuery.migrateTrace && console.trace ) {
          console.trace();
        }
      }
    }
  }

  function migrateWarnProp( obj, prop, value, msg ) {
    if ( Object.defineProperty ) {
      // On ES5 browsers (non-oldIE), warn if the code tries to get prop;
      // allow property to be overwritten in case some other plugin wants it
      try {
        Object.defineProperty( obj, prop, {
          configurable: true,
          enumerable: true,
          get: function() {
            migrateWarn( msg );
            return value;
          },
          set: function( newValue ) {
            migrateWarn( msg );
            value = newValue;
          }
        });
        return;
      } catch( err ) {
        // IE8 is a dope about Object.defineProperty, can't warn there
      }
    }

    // Non-ES5 (or broken) browser; just set the property
    jQuery._definePropertyBroken = true;
    obj[ prop ] = value;
  }

  if ( document.compatMode === "BackCompat" ) {
    // jQuery has never supported or tested Quirks Mode
    migrateWarn( "jQuery is not compatible with Quirks Mode" );
  }


  var attrFn = jQuery( "<input/>", { size: 1 } ).attr("size") && jQuery.attrFn,
  oldAttr = jQuery.attr,
  valueAttrGet = jQuery.attrHooks.value && jQuery.attrHooks.value.get ||
    function() { return null; },
  valueAttrSet = jQuery.attrHooks.value && jQuery.attrHooks.value.set ||
    function() { return undefined; },
  rnoType = /^(?:input|button)$/i,
  rnoAttrNodeType = /^[238]$/,
  rboolean = /^(?:autofocus|autoplay|async|checked|controls|defer|disabled|hidden|loop|multiple|open|readonly|required|scoped|selected)$/i,
  ruseDefault = /^(?:checked|selected)$/i;

  // jQuery.attrFn
  migrateWarnProp( jQuery, "attrFn", attrFn || {}, "jQuery.attrFn is deprecated" );

  jQuery.attr = function( elem, name, value, pass ) {
    var lowerName = name.toLowerCase(),
        nType = elem && elem.nodeType;

    if ( pass ) {
      // Since pass is used internally, we only warn for new jQuery
      // versions where there isn't a pass arg in the formal params
      if ( oldAttr.length < 4 ) {
        migrateWarn("jQuery.fn.attr( props, pass ) is deprecated");
      }
      if ( elem && !rnoAttrNodeType.test( nType ) &&
           (attrFn ? name in attrFn : jQuery.isFunction(jQuery.fn[name])) ) {
        return jQuery( elem )[ name ]( value );
      }
    }

    // Warn if user tries to set `type`, since it breaks on IE 6/7/8; by checking
    // for disconnected elements we don't warn on $( "<button>", { type: "button" } ).
    if ( name === "type" && value !== undefined && rnoType.test( elem.nodeName ) && elem.parentNode ) {
      migrateWarn("Can't change the 'type' of an input or button in IE 6/7/8");
    }

    // Restore boolHook for boolean property/attribute synchronization
    if ( !jQuery.attrHooks[ lowerName ] && rboolean.test( lowerName ) ) {
      jQuery.attrHooks[ lowerName ] = {
        get: function( elem, name ) {
          // Align boolean attributes with corresponding properties
          // Fall back to attribute presence where some booleans are not supported
          var attrNode,
          property = jQuery.prop( elem, name );
          return property === true || typeof property !== "boolean" &&
            ( attrNode = elem.getAttributeNode(name) ) && attrNode.nodeValue !== false ?

          name.toLowerCase() :
            undefined;
        },
        set: function( elem, value, name ) {
          var propName;
          if ( value === false ) {
            // Remove boolean attributes when set to false
            jQuery.removeAttr( elem, name );
          } else {
            // value is true since we know at this point it's type boolean and not false
            // Set boolean attributes to the same name and set the DOM property
            propName = jQuery.propFix[ name ] || name;
            if ( propName in elem ) {
              // Only set the IDL specifically if it already exists on the element
              elem[ propName ] = true;
            }

            elem.setAttribute( name, name.toLowerCase() );
          }
          return name;
        }
      };

      // Warn only for attributes that can remain distinct from their properties post-1.9
      if ( ruseDefault.test( lowerName ) ) {
        migrateWarn( "jQuery.fn.attr('" + lowerName + "') might use property instead of attribute" );
      }
    }

    return oldAttr.call( jQuery, elem, name, value );
  };

  // attrHooks: value
  jQuery.attrHooks.value = {
    get: function( elem, name ) {
      var nodeName = ( elem.nodeName || "" ).toLowerCase();
      if ( nodeName === "button" ) {
        return valueAttrGet.apply( this, arguments );
      }
      if ( nodeName !== "input" && nodeName !== "option" ) {
        migrateWarn("jQuery.fn.attr('value') no longer gets properties");
      }
      return name in elem ?
        elem.value :
        null;
    },
    set: function( elem, value ) {
      var nodeName = ( elem.nodeName || "" ).toLowerCase();
      if ( nodeName === "button" ) {
        return valueAttrSet.apply( this, arguments );
      }
      if ( nodeName !== "input" && nodeName !== "option" ) {
        migrateWarn("jQuery.fn.attr('value', val) no longer sets properties");
      }
      // Does not return so that setAttribute is also used
      elem.value = value;
    }
  };


  var matched, browser,
      oldInit = jQuery.fn.init,
      oldParseJSON = jQuery.parseJSON,
      rspaceAngle = /^\s*</,
      // Note: XSS check is done below after string is trimmed
      rquickExpr = /^([^<]*)(<[\w\W]+>)([^>]*)$/;

  // $(html) "looks like html" rule change
  jQuery.fn.init = function( selector, context, rootjQuery ) {
    var match, ret;

    if ( selector && typeof selector === "string" && !jQuery.isPlainObject( context ) &&
         (match = rquickExpr.exec( jQuery.trim( selector ) )) && match[ 0 ] ) {
      // This is an HTML string according to the "old" rules; is it still?
      if ( !rspaceAngle.test( selector ) ) {
        migrateWarn("$(html) HTML strings must start with '<' character");
      }
      if ( match[ 3 ] ) {
        migrateWarn("$(html) HTML text after last tag is ignored");
      }

      // Consistently reject any HTML-like string starting with a hash (#9521)
      // Note that this may break jQuery 1.6.x code that otherwise would work.
      if ( match[ 0 ].charAt( 0 ) === "#" ) {
        migrateWarn("HTML string cannot start with a '#' character");
        jQuery.error("JQMIGRATE: Invalid selector string (XSS)");
      }
      // Now process using loose rules; let pre-1.8 play too
      if ( context && context.context ) {
        // jQuery object as context; parseHTML expects a DOM object
        context = context.context;
      }
      if ( jQuery.parseHTML ) {
        return oldInit.call( this,
                             jQuery.parseHTML( match[ 2 ], context && context.ownerDocument ||
                                               context || document, true ), context, rootjQuery );
      }
    }

    // jQuery( "#" ) is a bogus ID selector, but it returned an empty set before jQuery 3.0
    if ( selector === "#" ) {
      migrateWarn( "jQuery( '#' ) is not a valid selector" );
      selector = [];
    }

    ret = oldInit.apply( this, arguments );

    // Fill in selector and context properties so .live() works
    if ( selector && selector.selector !== undefined ) {
      // A jQuery object, copy its properties
      ret.selector = selector.selector;
      ret.context = selector.context;

    } else {
      ret.selector = typeof selector === "string" ? selector : "";
      if ( selector ) {
        ret.context = selector.nodeType? selector : context || document;
      }
    }

    return ret;
  };
  jQuery.fn.init.prototype = jQuery.fn;

  // Let $.parseJSON(falsy_value) return null
  jQuery.parseJSON = function( json ) {
    if ( !json ) {
      migrateWarn("jQuery.parseJSON requires a valid JSON string");
      return null;
    }
    return oldParseJSON.apply( this, arguments );
  };

  jQuery.uaMatch = function( ua ) {
    ua = ua.toLowerCase();

    var match = /(chrome)[ \/]([\w.]+)/.exec( ua ) ||
      /(webkit)[ \/]([\w.]+)/.exec( ua ) ||
      /(opera)(?:.*version|)[ \/]([\w.]+)/.exec( ua ) ||
      /(msie) ([\w.]+)/.exec( ua ) ||
      ua.indexOf("compatible") < 0 && /(mozilla)(?:.*? rv:([\w.]+)|)/.exec( ua ) ||
      [];

    return {
      browser: match[ 1 ] || "",
      version: match[ 2 ] || "0"
    };
  };

  // Don't clobber any existing jQuery.browser in case it's different
  if ( !jQuery.browser ) {
    matched = jQuery.uaMatch( navigator.userAgent );
    browser = {};

    if ( matched.browser ) {
      browser[ matched.browser ] = true;
      browser.version = matched.version;
    }

    // Chrome is Webkit, but Webkit is also Safari.
    if ( browser.chrome ) {
      browser.webkit = true;
    } else if ( browser.webkit ) {
      browser.safari = true;
    }

    jQuery.browser = browser;
  }

  // Warn if the code tries to get jQuery.browser
  migrateWarnProp( jQuery, "browser", jQuery.browser, "jQuery.browser is deprecated" );

  // jQuery.boxModel deprecated in 1.3, jQuery.support.boxModel deprecated in 1.7
  jQuery.boxModel = jQuery.support.boxModel = (document.compatMode === "CSS1Compat");
  migrateWarnProp( jQuery, "boxModel", jQuery.boxModel, "jQuery.boxModel is deprecated" );
  migrateWarnProp( jQuery.support, "boxModel", jQuery.support.boxModel, "jQuery.support.boxModel is deprecated" );

  jQuery.sub = function() {
    function jQuerySub( selector, context ) {
      return new jQuerySub.fn.init( selector, context );
    }
    jQuery.extend( true, jQuerySub, this );
    jQuerySub.superclass = this;
    jQuerySub.fn = jQuerySub.prototype = this();
    jQuerySub.fn.constructor = jQuerySub;
    jQuerySub.sub = this.sub;
    jQuerySub.fn.init = function init( selector, context ) {
      var instance = jQuery.fn.init.call( this, selector, context, rootjQuerySub );
      return instance instanceof jQuerySub ?
        instance :
        jQuerySub( instance );
    };
    jQuerySub.fn.init.prototype = jQuerySub.fn;
    var rootjQuerySub = jQuerySub(document);
    migrateWarn( "jQuery.sub() is deprecated" );
    return jQuerySub;
  };

  // The number of elements contained in the matched element set
  jQuery.fn.size = function() {
    migrateWarn( "jQuery.fn.size() is deprecated; use the .length property" );
    return this.length;
  };


  var internalSwapCall = false;

  // If this version of jQuery has .swap(), don't false-alarm on internal uses
  if ( jQuery.swap ) {
    jQuery.each( [ "height", "width", "reliableMarginRight" ], function( _, name ) {
      var oldHook = jQuery.cssHooks[ name ] && jQuery.cssHooks[ name ].get;

      if ( oldHook ) {
        jQuery.cssHooks[ name ].get = function() {
          var ret;

          internalSwapCall = true;
          ret = oldHook.apply( this, arguments );
          internalSwapCall = false;
          return ret;
        };
      }
    });
  }

  jQuery.swap = function( elem, options, callback, args ) {
    var ret, name,
    old = {};

    if ( !internalSwapCall ) {
      migrateWarn( "jQuery.swap() is undocumented and deprecated" );
    }

    // Remember the old values, and insert the new ones
    for ( name in options ) {
      old[ name ] = elem.style[ name ];
      elem.style[ name ] = options[ name ];
    }

    ret = callback.apply( elem, args || [] );

    // Revert the old values
    for ( name in options ) {
      elem.style[ name ] = old[ name ];
    }

    return ret;
  };


  // Ensure that $.ajax gets the new parseJSON defined in core.js
  jQuery.ajaxSetup({
    converters: {
      "text json": jQuery.parseJSON
    }
  });


  var oldFnData = jQuery.fn.data;

  jQuery.fn.data = function( name ) {
    var ret, evt,
        elem = this[0];

    // Handles 1.7 which has this behavior and 1.8 which doesn't
    if ( elem && name === "events" && arguments.length === 1 ) {
      ret = jQuery.data( elem, name );
      evt = jQuery._data( elem, name );
      if ( ( ret === undefined || ret === evt ) && evt !== undefined ) {
        migrateWarn("Use of jQuery.fn.data('events') is deprecated");
        return evt;
      }
    }
    return oldFnData.apply( this, arguments );
  };


  var rscriptType = /\/(java|ecma)script/i;

  // Since jQuery.clean is used internally on older versions, we only shim if it's missing
  if ( !jQuery.clean ) {
    jQuery.clean = function( elems, context, fragment, scripts ) {
      // Set context per 1.8 logic
      context = context || document;
      context = !context.nodeType && context[0] || context;
      context = context.ownerDocument || context;

      migrateWarn("jQuery.clean() is deprecated");

      var i, elem, handleScript, jsTags,
      ret = [];

      jQuery.merge( ret, jQuery.buildFragment( elems, context ).childNodes );

      // Complex logic lifted directly from jQuery 1.8
      if ( fragment ) {
        // Special handling of each script element
        handleScript = function( elem ) {
          // Check if we consider it executable
          if ( !elem.type || rscriptType.test( elem.type ) ) {
            // Detach the script and store it in the scripts array (if provided) or the fragment
            // Return truthy to indicate that it has been handled
            return scripts ?
              scripts.push( elem.parentNode ? elem.parentNode.removeChild( elem ) : elem ) :
            fragment.appendChild( elem );
          }
        };

        for ( i = 0; (elem = ret[i]) != null; i++ ) {
          // Check if we're done after handling an executable script
          if ( !( jQuery.nodeName( elem, "script" ) && handleScript( elem ) ) ) {
            // Append to fragment and handle embedded scripts
            fragment.appendChild( elem );
            if ( typeof elem.getElementsByTagName !== "undefined" ) {
              // handleScript alters the DOM, so use jQuery.merge to ensure snapshot iteration
              jsTags = jQuery.grep( jQuery.merge( [], elem.getElementsByTagName("script") ), handleScript );

              // Splice the scripts into ret after their former ancestor and advance our index beyond them
              ret.splice.apply( ret, [i + 1, 0].concat( jsTags ) );
              i += jsTags.length;
            }
          }
        }
      }

      return ret;
    };
  }

  var eventAdd = jQuery.event.add,
  eventRemove = jQuery.event.remove,
  eventTrigger = jQuery.event.trigger,
  oldToggle = jQuery.fn.toggle,
  oldLive = jQuery.fn.live,
  oldDie = jQuery.fn.die,
  oldLoad = jQuery.fn.load,
  ajaxEvents = "ajaxStart|ajaxStop|ajaxSend|ajaxComplete|ajaxError|ajaxSuccess",
  rajaxEvent = new RegExp( "\\b(?:" + ajaxEvents + ")\\b" ),
  rhoverHack = /(?:^|\s)hover(\.\S+|)\b/,
  hoverHack = function( events ) {
    if ( typeof( events ) !== "string" || jQuery.event.special.hover ) {
      return events;
    }
    if ( rhoverHack.test( events ) ) {
      migrateWarn("'hover' pseudo-event is deprecated, use 'mouseenter mouseleave'");
    }
    return events && events.replace( rhoverHack, "mouseenter$1 mouseleave$1" );
  };

  // Event props removed in 1.9, put them back if needed; no practical way to warn them
  if ( jQuery.event.props && jQuery.event.props[ 0 ] !== "attrChange" ) {
    jQuery.event.props.unshift( "attrChange", "attrName", "relatedNode", "srcElement" );
  }

  // Undocumented jQuery.event.handle was "deprecated" in jQuery 1.7
  if ( jQuery.event.dispatch ) {
    migrateWarnProp( jQuery.event, "handle", jQuery.event.dispatch, "jQuery.event.handle is undocumented and deprecated" );
  }

  // Support for 'hover' pseudo-event and ajax event warnings
  jQuery.event.add = function( elem, types, handler, data, selector ){
    if ( elem !== document && rajaxEvent.test( types ) ) {
      migrateWarn( "AJAX events should be attached to document: " + types );
    }
    eventAdd.call( this, elem, hoverHack( types || "" ), handler, data, selector );
  };
  jQuery.event.remove = function( elem, types, handler, selector, mappedTypes ){
    eventRemove.call( this, elem, hoverHack( types ) || "", handler, selector, mappedTypes );
  };

  jQuery.each( [ "load", "unload", "error" ], function( _, name ) {

    jQuery.fn[ name ] = function() {
      var args = Array.prototype.slice.call( arguments, 0 );
      migrateWarn( "jQuery.fn." + name + "() is deprecated" );

      // If this is an ajax load() the first arg should be the string URL;
      // technically this could also be the "Anything" arg of the event .load()
      // which just goes to show why this dumb signature has been deprecated!
      // jQuery custom builds that exclude the Ajax module justifiably die here.
      if ( name === "load" && typeof arguments[ 0 ] === "string" ) {
        return oldLoad.apply( this, arguments );
      }

      args.splice( 0, 0, name );
      if ( arguments.length ) {
        return this.bind.apply( this, args );
      }

      // Use .triggerHandler here because:
      // - load and unload events don't need to bubble, only applied to window or image
      // - error event should not bubble to window, although it does pre-1.7
      // See http://bugs.jquery.com/ticket/11820
      this.triggerHandler.apply( this, args );
      return this;
    };

  });

  jQuery.fn.toggle = function( fn, fn2 ) {

    // Don't mess with animation or css toggles
    if ( !jQuery.isFunction( fn ) || !jQuery.isFunction( fn2 ) ) {
      return oldToggle.apply( this, arguments );
    }
    migrateWarn("jQuery.fn.toggle(handler, handler...) is deprecated");

    // Save reference to arguments for access in closure
    var args = arguments,
    guid = fn.guid || jQuery.guid++,
    i = 0,
    toggler = function( event ) {
      // Figure out which function to execute
      var lastToggle = ( jQuery._data( this, "lastToggle" + fn.guid ) || 0 ) % i;
      jQuery._data( this, "lastToggle" + fn.guid, lastToggle + 1 );

      // Make sure that clicks stop
      event.preventDefault();

      // and execute the function
      return args[ lastToggle ].apply( this, arguments ) || false;
    };

    // link all the functions, so any of them can unbind this click handler
    toggler.guid = guid;
    while ( i < args.length ) {
      args[ i++ ].guid = guid;
    }

    return this.click( toggler );
  };

  jQuery.fn.live = function( types, data, fn ) {
    migrateWarn("jQuery.fn.live() is deprecated");
    if ( oldLive ) {
      return oldLive.apply( this, arguments );
    }
    jQuery( this.context ).on( types, this.selector, data, fn );
    return this;
  };

  jQuery.fn.die = function( types, fn ) {
    migrateWarn("jQuery.fn.die() is deprecated");
    if ( oldDie ) {
      return oldDie.apply( this, arguments );
    }
    jQuery( this.context ).off( types, this.selector || "**", fn );
    return this;
  };

  // Turn global events into document-triggered events
  jQuery.event.trigger = function( event, data, elem, onlyHandlers  ){
    if ( !elem && !rajaxEvent.test( event ) ) {
      migrateWarn( "Global events are undocumented and deprecated" );
    }
    return eventTrigger.call( this,  event, data, elem || document, onlyHandlers  );
  };
  jQuery.each( ajaxEvents.split("|"),
               function( _, name ) {
                 jQuery.event.special[ name ] = {
                   setup: function() {
                     var elem = this;

                     // The document needs no shimming; must be !== for oldIE
                     if ( elem !== document ) {
                       jQuery.event.add( document, name + "." + jQuery.guid, function() {
                         jQuery.event.trigger( name, Array.prototype.slice.call( arguments, 1 ), elem, true );
                       });
                       jQuery._data( this, name, jQuery.guid++ );
                     }
                     return false;
                   },
                   teardown: function() {
                     if ( this !== document ) {
                       jQuery.event.remove( document, name + "." + jQuery._data( this, name ) );
                     }
                     return false;
                   }
                 };
               }
             );

  jQuery.event.special.ready = {
    setup: function() { migrateWarn( "'ready' event is deprecated" ); }
  };

  var oldSelf = jQuery.fn.andSelf || jQuery.fn.addBack,
      oldFind = jQuery.fn.find;

  jQuery.fn.andSelf = function() {
    migrateWarn("jQuery.fn.andSelf() replaced by jQuery.fn.addBack()");
    return oldSelf.apply( this, arguments );
  };

  jQuery.fn.find = function( selector ) {
    var ret = oldFind.apply( this, arguments );
    ret.context = this.context;
    ret.selector = this.selector ? this.selector + " " + selector : selector;
    return ret;
  };


  // jQuery 1.6 did not support Callbacks, do not warn there
  if ( jQuery.Callbacks ) {

    var oldDeferred = jQuery.Deferred,
    tuples = [
      // action, add listener, callbacks, .then handlers, final state
      [ "resolve", "done", jQuery.Callbacks("once memory"),
        jQuery.Callbacks("once memory"), "resolved" ],
      [ "reject", "fail", jQuery.Callbacks("once memory"),
        jQuery.Callbacks("once memory"), "rejected" ],
      [ "notify", "progress", jQuery.Callbacks("memory"),
        jQuery.Callbacks("memory") ]
    ];

    jQuery.Deferred = function( func ) {
      var deferred = oldDeferred(),
      promise = deferred.promise();

      deferred.pipe = promise.pipe = function( /* fnDone, fnFail, fnProgress */ ) {
        var fns = arguments;

        migrateWarn( "deferred.pipe() is deprecated" );

        return jQuery.Deferred(function( newDefer ) {
          jQuery.each( tuples, function( i, tuple ) {
            var fn = jQuery.isFunction( fns[ i ] ) && fns[ i ];
            // deferred.done(function() { bind to newDefer or newDefer.resolve })
            // deferred.fail(function() { bind to newDefer or newDefer.reject })
            // deferred.progress(function() { bind to newDefer or newDefer.notify })
            deferred[ tuple[1] ](function() {
              var returned = fn && fn.apply( this, arguments );
              if ( returned && jQuery.isFunction( returned.promise ) ) {
                returned.promise()
                  .done( newDefer.resolve )
                  .fail( newDefer.reject )
                  .progress( newDefer.notify );
              } else {
                newDefer[ tuple[ 0 ] + "With" ](
                  this === promise ? newDefer.promise() : this,
                  fn ? [ returned ] : arguments
                );
              }
            });
          });
          fns = null;
        }).promise();

      };

      deferred.isResolved = function() {
        migrateWarn( "deferred.isResolved is deprecated" );
        return deferred.state() === "resolved";
      };

      deferred.isRejected = function() {
        migrateWarn( "deferred.isRejected is deprecated" );
        return deferred.state() === "rejected";
      };

      if ( func ) {
        func.call( deferred, deferred );
      }

      return deferred;
    };

  }

});
(function($, undefined) {

/**
 * Unobtrusive scripting adapter for jQuery
 * https://github.com/rails/jquery-ujs
 *
 * Requires jQuery 1.7.0 or later.
 *
 * Released under the MIT license
 *
 */

  // Cut down on the number if issues from people inadvertently including jquery_ujs twice
  // by detecting and raising an error when it happens.
  var alreadyInitialized = function() {
    var events = $._data(document, 'events');
    return events && events.click && $.grep(events.click, function(e) { return e.namespace === 'rails'; }).length;
  }

  if ( alreadyInitialized() ) {
    $.error('jquery-ujs has already been loaded!');
  }

  // Shorthand to make it a little easier to call public rails functions from within rails.js
  var rails;

  $.rails = rails = {
    // Link elements bound by jquery-ujs
    linkClickSelector: 'a[data-confirm], a[data-method], a[data-remote], a[data-disable-with]',

    // Select elements bound by jquery-ujs
    inputChangeSelector: 'select[data-remote], input[data-remote], textarea[data-remote]',

    // Form elements bound by jquery-ujs
    formSubmitSelector: 'form',

    // Form input elements bound by jquery-ujs
    formInputClickSelector: 'form input[type=submit], form input[type=image], form button[type=submit], form button:not([type])',

    // Form input elements disabled during form submission
    disableSelector: 'input[data-disable-with], button[data-disable-with], textarea[data-disable-with]',

    // Form input elements re-enabled after form submission
    enableSelector: 'input[data-disable-with]:disabled, button[data-disable-with]:disabled, textarea[data-disable-with]:disabled',

    // Form required input elements
    requiredInputSelector: 'input[name][required]:not([disabled]),textarea[name][required]:not([disabled])',

    // Form file input elements
    fileInputSelector: 'input[type=file]',

    // Link onClick disable selector with possible reenable after remote submission
    linkDisableSelector: 'a[data-disable-with]',

    // Make sure that every Ajax request sends the CSRF token
    CSRFProtection: function(xhr) {
      var token = $('meta[name="csrf-token"]').attr('content');
      if (token) xhr.setRequestHeader('X-CSRF-Token', token);
    },

    // Triggers an event on an element and returns false if the event result is false
    fire: function(obj, name, data) {
      var event = $.Event(name);
      obj.trigger(event, data);
      return event.result !== false;
    },

    // Default confirm dialog, may be overridden with custom confirm dialog in $.rails.confirm
    confirm: function(message) {
      return confirm(message);
    },

    // Default ajax function, may be overridden with custom function in $.rails.ajax
    ajax: function(options) {
      return $.ajax(options);
    },

    // Default way to get an element's href. May be overridden at $.rails.href.
    href: function(element) {
      return element.attr('href');
    },

    // Submits "remote" forms and links with ajax
    handleRemote: function(element) {
      var method, url, data, elCrossDomain, crossDomain, withCredentials, dataType, options;

      if (rails.fire(element, 'ajax:before')) {
        elCrossDomain = element.data('cross-domain');
        crossDomain = elCrossDomain === undefined ? null : elCrossDomain;
        withCredentials = element.data('with-credentials') || null;
        dataType = element.data('type') || ($.ajaxSettings && $.ajaxSettings.dataType);

        if (element.is('form')) {
          method = element.attr('method');
          url = element.attr('action');
          data = element.serializeArray();
          // memoized value from clicked submit button
          var button = element.data('ujs:submit-button');
          if (button) {
            data.push(button);
            element.data('ujs:submit-button', null);
          }
        } else if (element.is(rails.inputChangeSelector)) {
          method = element.data('method');
          url = element.data('url');
          data = element.serialize();
          if (element.data('params')) data = data + "&" + element.data('params');
        } else {
          method = element.data('method');
          url = rails.href(element);
          data = element.data('params') || null;
        }

        options = {
          type: method || 'GET', data: data, dataType: dataType,
          // stopping the "ajax:beforeSend" event will cancel the ajax request
          beforeSend: function(xhr, settings) {
            if (settings.dataType === undefined) {
              xhr.setRequestHeader('accept', '*/*;q=0.5, ' + settings.accepts.script);
            }
            return rails.fire(element, 'ajax:beforeSend', [xhr, settings]);
          },
          success: function(data, status, xhr) {
            element.trigger('ajax:success', [data, status, xhr]);
          },
          complete: function(xhr, status) {
            element.trigger('ajax:complete', [xhr, status]);
          },
          error: function(xhr, status, error) {
            element.trigger('ajax:error', [xhr, status, error]);
          },
          crossDomain: crossDomain
        };

        // There is no withCredentials for IE6-8 when
        // "Enable native XMLHTTP support" is disabled
        if (withCredentials) {
          options.xhrFields = {
            withCredentials: withCredentials
          };
        }

        // Only pass url to `ajax` options if not blank
        if (url) { options.url = url; }

        var jqxhr = rails.ajax(options);
        element.trigger('ajax:send', jqxhr);
        return jqxhr;
      } else {
        return false;
      }
    },

    // Handles "data-method" on links such as:
    // <a href="/users/5" data-method="delete" rel="nofollow" data-confirm="Are you sure?">Delete</a>
    handleMethod: function(link) {
      var href = rails.href(link),
        method = link.data('method'),
        target = link.attr('target'),
        csrf_token = $('meta[name=csrf-token]').attr('content'),
        csrf_param = $('meta[name=csrf-param]').attr('content'),
        form = $('<form method="post" action="' + href + '"></form>'),
        metadata_input = '<input name="_method" value="' + method + '" type="hidden" />';

      if (csrf_param !== undefined && csrf_token !== undefined) {
        metadata_input += '<input name="' + csrf_param + '" value="' + csrf_token + '" type="hidden" />';
      }

      if (target) { form.attr('target', target); }

      form.hide().append(metadata_input).appendTo('body');
      form.submit();
    },

    /* Disables form elements:
      - Caches element value in 'ujs:enable-with' data store
      - Replaces element text with value of 'data-disable-with' attribute
      - Sets disabled property to true
    */
    disableFormElements: function(form) {
      form.find(rails.disableSelector).each(function() {
        var element = $(this), method = element.is('button') ? 'html' : 'val';
        element.data('ujs:enable-with', element[method]());
        element[method](element.data('disable-with'));
        element.prop('disabled', true);
      });
    },

    /* Re-enables disabled form elements:
      - Replaces element text with cached value from 'ujs:enable-with' data store (created in `disableFormElements`)
      - Sets disabled property to false
    */
    enableFormElements: function(form) {
      form.find(rails.enableSelector).each(function() {
        var element = $(this), method = element.is('button') ? 'html' : 'val';
        if (element.data('ujs:enable-with')) element[method](element.data('ujs:enable-with'));
        element.prop('disabled', false);
      });
    },

   /* For 'data-confirm' attribute:
      - Fires `confirm` event
      - Shows the confirmation dialog
      - Fires the `confirm:complete` event

      Returns `true` if no function stops the chain and user chose yes; `false` otherwise.
      Attaching a handler to the element's `confirm` event that returns a `falsy` value cancels the confirmation dialog.
      Attaching a handler to the element's `confirm:complete` event that returns a `falsy` value makes this function
      return false. The `confirm:complete` event is fired whether or not the user answered true or false to the dialog.
   */
    allowAction: function(element) {
      var message = element.data('confirm'),
          answer = false, callback;
      if (!message) { return true; }

      if (rails.fire(element, 'confirm')) {
        answer = rails.confirm(message);
        callback = rails.fire(element, 'confirm:complete', [answer]);
      }
      return answer && callback;
    },

    // Helper function which checks for blank inputs in a form that match the specified CSS selector
    blankInputs: function(form, specifiedSelector, nonBlank) {
      var inputs = $(), input, valueToCheck,
          selector = specifiedSelector || 'input,textarea',
          allInputs = form.find(selector);

      allInputs.each(function() {
        input = $(this);
        valueToCheck = input.is('input[type=checkbox],input[type=radio]') ? input.is(':checked') : input.val();
        // If nonBlank and valueToCheck are both truthy, or nonBlank and valueToCheck are both falsey
        if (!valueToCheck === !nonBlank) {

          // Don't count unchecked required radio if other radio with same name is checked
          if (input.is('input[type=radio]') && allInputs.filter('input[type=radio]:checked[name="' + input.attr('name') + '"]').length) {
            return true; // Skip to next input
          }

          inputs = inputs.add(input);
        }
      });
      return inputs.length ? inputs : false;
    },

    // Helper function which checks for non-blank inputs in a form that match the specified CSS selector
    nonBlankInputs: function(form, specifiedSelector) {
      return rails.blankInputs(form, specifiedSelector, true); // true specifies nonBlank
    },

    // Helper function, needed to provide consistent behavior in IE
    stopEverything: function(e) {
      $(e.target).trigger('ujs:everythingStopped');
      e.stopImmediatePropagation();
      return false;
    },

    // find all the submit events directly bound to the form and
    // manually invoke them. If anyone returns false then stop the loop
    callFormSubmitBindings: function(form, event) {
      var events = form.data('events'), continuePropagation = true;
      if (events !== undefined && events['submit'] !== undefined) {
        $.each(events['submit'], function(i, obj){
          if (typeof obj.handler === 'function') return continuePropagation = obj.handler(event);
        });
      }
      return continuePropagation;
    },

    //  replace element's html with the 'data-disable-with' after storing original html
    //  and prevent clicking on it
    disableElement: function(element) {
      element.data('ujs:enable-with', element.html()); // store enabled state
      element.html(element.data('disable-with')); // set to disabled state
      element.bind('click.railsDisable', function(e) { // prevent further clicking
        return rails.stopEverything(e);
      });
    },

    // restore element to its original state which was disabled by 'disableElement' above
    enableElement: function(element) {
      if (element.data('ujs:enable-with') !== undefined) {
        element.html(element.data('ujs:enable-with')); // set to old enabled state
        // this should be element.removeData('ujs:enable-with')
        // but, there is currently a bug in jquery which makes hyphenated data attributes not get removed
        element.data('ujs:enable-with', false); // clean up cache
      }
      element.unbind('click.railsDisable'); // enable element
    }

  };

  if (rails.fire($(document), 'rails:attachBindings')) {

    $.ajaxPrefilter(function(options, originalOptions, xhr){ if ( !options.crossDomain ) { rails.CSRFProtection(xhr); }});

    $(document).delegate(rails.linkDisableSelector, 'ajax:complete', function() {
        rails.enableElement($(this));
    });

    $(document).delegate(rails.linkClickSelector, 'click.rails', function(e) {
      var link = $(this), method = link.data('method'), data = link.data('params');
      if (!rails.allowAction(link)) return rails.stopEverything(e);

      if (link.is(rails.linkDisableSelector)) rails.disableElement(link);

      if (link.data('remote') !== undefined) {
        if ( (e.metaKey || e.ctrlKey) && (!method || method === 'GET') && !data ) { return true; }

        var handleRemote = rails.handleRemote(link);
        // response from rails.handleRemote() will either be false or a deferred object promise.
        if (handleRemote === false) {
          rails.enableElement(link);
        } else {
          handleRemote.error( function() { rails.enableElement(link); } );
        }
        return false;

      } else if (link.data('method')) {
        rails.handleMethod(link);
        return false;
      }
    });

    $(document).delegate(rails.inputChangeSelector, 'change.rails', function(e) {
      var link = $(this);
      if (!rails.allowAction(link)) return rails.stopEverything(e);

      rails.handleRemote(link);
      return false;
    });

    $(document).delegate(rails.formSubmitSelector, 'submit.rails', function(e) {
      var form = $(this),
        remote = form.data('remote') !== undefined,
        blankRequiredInputs = rails.blankInputs(form, rails.requiredInputSelector),
        nonBlankFileInputs = rails.nonBlankInputs(form, rails.fileInputSelector);

      if (!rails.allowAction(form)) return rails.stopEverything(e);

      // skip other logic when required values are missing or file upload is present
      if (blankRequiredInputs && form.attr("novalidate") == undefined && rails.fire(form, 'ajax:aborted:required', [blankRequiredInputs])) {
        return rails.stopEverything(e);
      }

      if (remote) {
        if (nonBlankFileInputs) {
          // slight timeout so that the submit button gets properly serialized
          // (make it easy for event handler to serialize form without disabled values)
          setTimeout(function(){ rails.disableFormElements(form); }, 13);
          var aborted = rails.fire(form, 'ajax:aborted:file', [nonBlankFileInputs]);

          // re-enable form elements if event bindings return false (canceling normal form submission)
          if (!aborted) { setTimeout(function(){ rails.enableFormElements(form); }, 13); }

          return aborted;
        }

        // If browser does not support submit bubbling, then this live-binding will be called before direct
        // bindings. Therefore, we should directly call any direct bindings before remotely submitting form.
        if (!$.support.submitBubbles && $().jquery < '1.7' && rails.callFormSubmitBindings(form, e) === false) return rails.stopEverything(e);

        rails.handleRemote(form);
        return false;

      } else {
        // slight timeout so that the submit button gets properly serialized
        setTimeout(function(){ rails.disableFormElements(form); }, 13);
      }
    });

    $(document).delegate(rails.formInputClickSelector, 'click.rails', function(event) {
      var button = $(this);

      if (!rails.allowAction(button)) return rails.stopEverything(event);

      // register the pressed submit button
      var name = button.attr('name'),
        data = name ? {name:name, value:button.val()} : null;

      button.closest('form').data('ujs:submit-button', data);
    });

    $(document).delegate(rails.formSubmitSelector, 'ajax:beforeSend.rails', function(event) {
      if (this == event.target) rails.disableFormElements($(this));
    });

    $(document).delegate(rails.formSubmitSelector, 'ajax:complete.rails', function(event) {
      if (this == event.target) rails.enableFormElements($(this));
    });

    $(function(){
      // making sure that all forms have actual up-to-date token(cached forms contain old one)
      var csrf_token = $('meta[name=csrf-token]').attr('content');
      var csrf_param = $('meta[name=csrf-param]').attr('content');
      $('form input[name="' + csrf_param + '"]').val(csrf_token);
    });
  }

})( jQuery );

/**
 * Cookie plugin
 *
 * Copyright (c) 2006 Klaus Hartl (stilbuero.de)
 * Dual licensed under the MIT and GPL licenses:
 * http://www.opensource.org/licenses/mit-license.php
 * http://www.gnu.org/licenses/gpl.html
 *
 */


/**
 * Create a cookie with the given name and value and other optional parameters.
 *
 * @example $.cookie('the_cookie', 'the_value');
 * @desc Set the value of a cookie.
 * @example $.cookie('the_cookie', 'the_value', { expires: 7, path: '/', domain: 'jquery.com', secure: true });
 * @desc Create a cookie with all available options.
 * @example $.cookie('the_cookie', 'the_value');
 * @desc Create a session cookie.
 * @example $.cookie('the_cookie', null);
 * @desc Delete a cookie by passing null as value. Keep in mind that you have to use the same path and domain
 *       used when the cookie was set.
 *
 * @param String name The name of the cookie.
 * @param String value The value of the cookie.
 * @param Object options An object literal containing key/value pairs to provide optional cookie attributes.
 * @option Number|Date expires Either an integer specifying the expiration date from now on in days or a Date object.
 *                             If a negative value is specified (e.g. a date in the past), the cookie will be deleted.
 *                             If set to null or omitted, the cookie will be a session cookie and will not be retained
 *                             when the the browser exits.
 * @option String path The value of the path atribute of the cookie (default: path of page that created the cookie).
 * @option String domain The value of the domain attribute of the cookie (default: domain of page that created the cookie).
 * @option Boolean secure If true, the secure attribute of the cookie will be set and the cookie transmission will
 *                        require a secure protocol (like HTTPS).
 * @type undefined
 *
 * @name $.cookie
 * @cat Plugins/Cookie
 * @author Klaus Hartl/klaus.hartl@stilbuero.de
 */


/**
 * Get the value of a cookie with the given name.
 *
 * @example $.cookie('the_cookie');
 * @desc Get the value of a cookie.
 *
 * @param String name The name of the cookie.
 * @return The value of the cookie.
 * @type String
 *
 * @name $.cookie
 * @cat Plugins/Cookie
 * @author Klaus Hartl/klaus.hartl@stilbuero.de
 */

(function() {
  var module;

  module = function($) {
    return $.cookie = function(name, value, options) {
      var cookie, cookieValue, cookies, date, domain, expires, i, path, secure;
      if (typeof value !== 'undefined') {
        options = options || {};
        if (value === null) {
          value = '';
          options.expires = -1;
        }
        expires = '';
        if (options.expires && (typeof options.expires === 'number' || options.expires.toUTCString)) {
          date = void 0;
          if (typeof options.expires === 'number') {
            date = new Date;
            date.setTime(date.getTime() + options.expires * 24 * 60 * 60 * 1000);
          } else {
            date = options.expires;
          }
          expires = '; expires=' + date.toUTCString();
        }
        path = options.path ? '; path=' + options.path : '';
        domain = options.domain ? '; domain=' + options.domain : '';
        secure = options.secure ? '; secure' : '';
        return document.cookie = [name, '=', encodeURIComponent(value), expires, path, domain, secure].join('');
      } else {
        cookieValue = null;
        if (document.cookie && document.cookie !== '') {
          cookies = document.cookie.split(';');
          i = 0;
          while (i < cookies.length) {
            cookie = $.trim(cookies[i]);
            if (cookie.substring(0, name.length + 1) === name + '=') {
              cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
              break;
            }
            i++;
          }
        }
        return cookieValue;
      }
    };
  };

  if (typeof define === 'function' && define.amd) {
    define('jquery.cookie', ['jquery'], module);
  } else {
    module(window.jQuery);
  }

}).call(this);
(function() {
  define('jquery.trigger_custom', ['jquery'], function($) {
    var CustomEvent;
    if (typeof window.CustomEvent !== 'function') {
      CustomEvent = function(event, params) {
        var evt;
        params = params || {
          bubbles: false,
          cancelable: false,
          detail: void 0
        };
        evt = document.createEvent('CustomEvent');
        evt.initCustomEvent(event, params.bubbles, params.cancelable, params.detail);
        return evt;
      };
      CustomEvent.prototype = window.Event.prototype;
      window.CustomEvent = CustomEvent;
    }
    return $.fn['triggerCustom'] = function(type, data, options) {
      if (options == null) {
        options = {};
      }
      options = $.extend({}, {
        bubbles: true,
        cancelable: true,
        detail: data
      }, {
        bubbles: options.bubbles,
        cancelable: options.cancelable
      });
      return this.each(function() {
        var e;
        e = new window.CustomEvent(type, options);
        return this.dispatchEvent(e);
      });
    };
  });

}).call(this);
/*
 *
 * Портировано из гема i18n-js
 *
 */

define('i18n', function() {
  // Instantiate the object
  var I18n = I18n || {};

  // Set default locale to english
  I18n.defaultLocale = "en";

  // Set default handling of translation fallbacks to false
  I18n.fallbacks = false;

  // Set default separator
  I18n.defaultSeparator = ".";

  // Set current locale to null
  I18n.locale = null;

  // Set the placeholder format. Accepts `{{placeholder}}` and `%{placeholder}`.
  I18n.PLACEHOLDER = /(?:\{\{|%\{)(.*?)(?:\}\}?)/gm;

  I18n.isValidNode = function(obj, node, undefined) {
      return obj[node] !== null && obj[node] !== undefined;
  }

  I18n.lookup = function(scope, options) {
    var options = options || {}
      , lookupInitialScope = scope
      , translations = this.prepareOptions(I18n.translations)
      , messages = translations[options.locale || I18n.currentLocale()]
      , options = this.prepareOptions(options)
      , currentScope
    ;

    if (!messages){
      return;
    }

    if (typeof(scope) == "object") {
      scope = scope.join(this.defaultSeparator);
    }

    if (options.scope) {
      scope = options.scope.toString() + this.defaultSeparator + scope;
    }

    scope = scope.split(this.defaultSeparator);

    while (scope.length > 0) {
      currentScope = scope.shift();
      messages = messages[currentScope];

      if (!messages) {
        if (I18n.fallbacks && !options.fallback) {
          messages = I18n.lookup(lookupInitialScope, this.prepareOptions({ locale: I18n.defaultLocale, fallback: true }, options));
        }
        break;
      }
    }

    if (!messages && this.isValidNode(options, "defaultValue")) {
      messages = options.defaultValue;
    }

    return messages;
  };

  // Merge serveral hash options, checking if value is set before
  // overwriting any value. The precedence is from left to right.
  //
  //   I18n.prepareOptions({name: "John Doe"}, {name: "Mary Doe", role: "user"});
  //   #=> {name: "John Doe", role: "user"}
  //
  I18n.prepareOptions = function() {
    var options = {}
      , opts
      , count = arguments.length
    ;

    for (var i = 0; i < count; i++) {
      opts = arguments[i];

      if (!opts) {
        continue;
      }

      for (var key in opts) {
        if (!this.isValidNode(options, key)) {
          options[key] = opts[key];
        }
      }
    }

    return options;
  };

  I18n.interpolate = function(message, options) {
    options = this.prepareOptions(options);
    var matches = message.match(this.PLACEHOLDER)
      , placeholder
      , value
      , name
    ;

    if (!matches) {
      return message;
    }

    for (var i = 0; placeholder = matches[i]; i++) {
      name = placeholder.replace(this.PLACEHOLDER, "$1");

      value = options[name];

      if (!this.isValidNode(options, name)) {
        value = "[missing " + placeholder + " value]";
      }

      regex = new RegExp(placeholder.replace(/\{/gm, "\\{").replace(/\}/gm, "\\}"));
      message = message.replace(regex, value);
    }

    return message;
  };

  I18n.translate = function(scope, options) {
    options = this.prepareOptions(options);
    var translation = this.lookup(scope, options);

    try {
      if (typeof(translation) == "object") {
        if (typeof(options.count) == "number") {
          return this.pluralize(options.count, scope, options);
        } else {
          return translation;
        }
      } else {
        return this.interpolate(translation, options);
      }
    } catch(err) {
      return this.missingTranslation(scope);
    }
  };

  I18n.localize = function(scope, value) {
    switch (scope) {
      case "currency":
        return this.toCurrency(value);
      case "number":
        scope = this.lookup("number.format");
        return this.toNumber(value, scope);
      case "percentage":
        return this.toPercentage(value);
      default:
        if (scope.match(/^(date|time)/)) {
          return this.toTime(scope, value);
        } else {
          return value.toString();
        }
    }
  };

  I18n.parseDate = function(date) {
    var matches, convertedDate;

    // we have a date, so just return it.
    if (typeof(date) == "object") {
      return date;
    };

    // it matches the following formats:
    //   yyyy-mm-dd
    //   yyyy-mm-dd[ T]hh:mm::ss
    //   yyyy-mm-dd[ T]hh:mm::ss
    //   yyyy-mm-dd[ T]hh:mm::ssZ
    //   yyyy-mm-dd[ T]hh:mm::ss+0000
    //
    matches = date.toString().match(/(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2}))?(Z|\+0000)?/);

    if (matches) {
      for (var i = 1; i <= 6; i++) {
        matches[i] = parseInt(matches[i], 10) || 0;
      }

      // month starts on 0
      matches[2] -= 1;

      if (matches[7]) {
        convertedDate = new Date(Date.UTC(matches[1], matches[2], matches[3], matches[4], matches[5], matches[6]));
      } else {
        convertedDate = new Date(matches[1], matches[2], matches[3], matches[4], matches[5], matches[6]);
      }
    } else if (typeof(date) == "number") {
      // UNIX timestamp
      convertedDate = new Date();
      convertedDate.setTime(date);
    } else if (date.match(/\d+ \d+:\d+:\d+ [+-]\d+ \d+/)) {
      // a valid javascript format with timezone info
      convertedDate = new Date();
      convertedDate.setTime(Date.parse(date))
    } else {
      // an arbitrary javascript string
      convertedDate = new Date();
      convertedDate.setTime(Date.parse(date));
    }

    return convertedDate;
  };

  I18n.toTime = function(scope, d) {
    var date = this.parseDate(d)
      , format = this.lookup(scope)
    ;

    if (date.toString().match(/invalid/i)) {
      return date.toString();
    }

    if (!format) {
      return date.toString();
    }

    return this.strftime(date, format);
  };

  I18n.strftime = function(date, format) {
    var options = this.lookup("date");

    if (!options) {
      return date.toString();
    }

    options.meridian = options.meridian || ["AM", "PM"];

    var weekDay = date.getDay()
      , day = date.getDate()
      , year = date.getFullYear()
      , month = date.getMonth() + 1
      , hour = date.getHours()
      , hour12 = hour
      , meridian = hour > 11 ? 1 : 0
      , secs = date.getSeconds()
      , mins = date.getMinutes()
      , offset = date.getTimezoneOffset()
      , absOffsetHours = Math.floor(Math.abs(offset / 60))
      , absOffsetMinutes = Math.abs(offset) - (absOffsetHours * 60)
      , timezoneoffset = (offset > 0 ? "-" : "+") + (absOffsetHours.toString().length < 2 ? "0" + absOffsetHours : absOffsetHours) + (absOffsetMinutes.toString().length < 2 ? "0" + absOffsetMinutes : absOffsetMinutes)
    ;

    if (hour12 > 12) {
      hour12 = hour12 - 12;
    } else if (hour12 === 0) {
      hour12 = 12;
    }

    var padding = function(n) {
      var s = "0" + n.toString();
      return s.substr(s.length - 2);
    };

    var f = format;
    f = f.replace("%a", options.abbr_day_names[weekDay]);
    f = f.replace("%A", options.day_names[weekDay]);
    f = f.replace("%b", options.abbr_month_names[month]);
    f = f.replace("%B", options.month_names[month]);
    f = f.replace("%d", padding(day));
    f = f.replace("%e", day);
    f = f.replace("%-d", day);
    f = f.replace("%H", padding(hour));
    f = f.replace("%-H", hour);
    f = f.replace("%I", padding(hour12));
    f = f.replace("%-I", hour12);
    f = f.replace("%m", padding(month));
    f = f.replace("%-m", month);
    f = f.replace("%M", padding(mins));
    f = f.replace("%-M", mins);
    f = f.replace("%p", options.meridian[meridian]);
    f = f.replace("%S", padding(secs));
    f = f.replace("%-S", secs);
    f = f.replace("%w", weekDay);
    f = f.replace("%y", padding(year));
    f = f.replace("%-y", padding(year).replace(/^0+/, ""));
    f = f.replace("%Y", year);
    f = f.replace("%z", timezoneoffset);

    return f;
  };

  I18n.toNumber = function(number, options) {
    options = this.prepareOptions(
      options,
      this.lookup("number.format"),
      {precision: 3, separator: ".", delimiter: ",", strip_insignificant_zeros: false}
    );

    var negative = number < 0
      , string = Math.abs(number).toFixed(options.precision).toString()
      , parts = string.split(".")
      , precision
      , buffer = []
      , formattedNumber
    ;

    number = parts[0];
    precision = parts[1];

    while (number.length > 0) {
      buffer.unshift(number.substr(Math.max(0, number.length - 3), 3));
      number = number.substr(0, number.length -3);
    }

    formattedNumber = buffer.join(options.delimiter);

    if (options.precision > 0) {
      formattedNumber += options.separator + parts[1];
    }

    if (negative) {
      formattedNumber = "-" + formattedNumber;
    }

    if (options.strip_insignificant_zeros) {
      var regex = {
          separator: new RegExp(options.separator.replace(/\./, "\\.") + "$")
        , zeros: /0+$/
      };

      formattedNumber = formattedNumber
        .replace(regex.zeros, "")
        .replace(regex.separator, "")
      ;
    }

    return formattedNumber;
  };

  I18n.toCurrency = function(number, options) {
    options = this.prepareOptions(
      options,
      this.lookup("number.currency.format"),
      this.lookup("number.format"),
      {unit: "$", precision: 2, format: "%u%n", delimiter: ",", separator: "."}
    );

    number = this.toNumber(number, options);
    number = options.format
      .replace("%u", options.unit)
      .replace("%n", number)
    ;

    return number;
  };

  I18n.toHumanSize = function(number, options) {
    var kb = 1024
      , size = number
      , iterations = 0
      , unit
      , precision
    ;

    while (size >= kb && iterations < 4) {
      size = size / kb;
      iterations += 1;
    }

    if (iterations === 0) {
      unit = this.t("number.human.storage_units.units.byte", {count: size});
      precision = 0;
    } else {
      unit = this.t("number.human.storage_units.units." + [null, "kb", "mb", "gb", "tb"][iterations]);
      precision = (size - Math.floor(size) === 0) ? 0 : 1;
    }

    options = this.prepareOptions(
      options,
      {precision: precision, format: "%n%u", delimiter: ""}
    );

    number = this.toNumber(size, options);
    number = options.format
      .replace("%u", unit)
      .replace("%n", number)
    ;

    return number;
  };

  I18n.toPercentage = function(number, options) {
    options = this.prepareOptions(
      options,
      this.lookup("number.percentage.format"),
      this.lookup("number.format"),
      {precision: 3, separator: ".", delimiter: ""}
    );

    number = this.toNumber(number, options);
    return number + "%";
  };

  I18n.pluralize = function(count, scope, options) {
    var translation;

    try {
      translation = this.lookup(scope, options);
    } catch (error) {}

    if (!translation) {
      return this.missingTranslation(scope);
    }

    var message;
    options = this.prepareOptions(options);
    options.count = count.toString();

    switch(Math.abs(count)) {
      case 0:
        message = this.isValidNode(translation, "zero") ? translation.zero :
                  this.isValidNode(translation, "none") ? translation.none :
                  this.isValidNode(translation, "other") ? translation.other :
                  this.missingTranslation(scope, "zero");
        break;
      case 1:
        message = this.isValidNode(translation, "one") ? translation.one : this.missingTranslation(scope, "one");
        break;
      default:
        message = this.isValidNode(translation, "other") ? translation.other : this.missingTranslation(scope, "other");
    }

    return this.interpolate(message, options);
  };

  I18n.missingTranslation = function() {
    var message = '[missing "' + this.currentLocale()
      , count = arguments.length
    ;

    for (var i = 0; i < count; i++) {
      message += "." + arguments[i];
    }

    message += '" translation]';

    return message;
  };

  I18n.currentLocale = function() {
    return (I18n.locale || I18n.defaultLocale);
  };

  // shortcuts
  I18n.t = I18n.translate;
  I18n.l = I18n.localize;
  I18n.p = I18n.pluralize;

  return I18n;
});

require(['i18n'], function(I18n) {
   var I18n = I18n || {};
I18n.translations = {"en":{"number":{"currency":{"format":{"delimiter":",","format":"%u %n","precision":2,"separator":".","significant":false,"strip_insignificant_zeros":false,"unit":"$"}},"format":{"delimiter":",","precision":3,"separator":".","significant":false,"strip_insignificant_zeros":false},"human":{"decimal_units":{"format":"%n %u","units":{"billion":{"one":"billion","other":"billions"},"million":{"one":"million","other":"millions"},"quadrillion":{"one":"quadrillion","other":"quadrillions"},"thousand":{"one":"thousand","other":"thousands"},"trillion":{"one":"trillion","other":"trillions"},"unit":""}},"format":{"delimiter":"","precision":1,"significant":true,"strip_insignificant_zeros":true},"storage_units":{"format":"%n %u","units":{"byte":{"few":"Bytes","many":"Bytes","one":"Byte","other":"Bytes"},"gb":"GB","kb":"KB","mb":"MB","tb":"TB"}}},"percentage":{"format":{"delimiter":"","format":"%n%"}},"precision":{"format":{"delimiter":""}},"quantity":"pcs.","weight":{"mili":{"one":"gr","other":"gr","zero":"gr"},"unit":{"one":"kg","other":"kg","zero":"kg"}}},"shop":{"common_js":{"compare":"Compare","max_products":"You can compare not more than 4 products at once","product_added":"Product added","product_added_for_compare":"Product selected to compare","product_already_added":"This product is already added"},"find":"Find","order_registration":{"account":"Your account","accumulated_discount_title":"Accumulated discount points","additional_info":"Additional info","address_updated":"Shipping address saved","addresses_title":"Shipping address","already_client":"Purchased from us before?","antibot_protection":"Automatic registration protection","authorized_as":"You are logged in as","barcode":"Barcode","bonus":{"reason":"Reason"},"bonus_balance":"Bonus balance","bonuses":"Bonuses","captcha_label":"Type the text from the image above","change_default_address":"Change default address","change_password":"Change password","check_checkout_data":"Please check order details and confirm to proceed to checkout","client_bonus_points_html":{"one":"You have \u003Cb\u003E%{count}\u003C/b\u003E point.","other":"You have \u003Cb\u003E%{count}\u003C/b\u003E points."},"client_bonus_points_question":"How much would you like to spend?","client_discount_title":"Personal discount points","client_room_title":"Buyer account","comment":"Comments","confirm":"Place my order!","confirm_payment":"Confirm payment","confirmation":"Confirmation","contact_details":"Personal data","contacts":"Contacts","contacts_title":"Personal data","contacts_updated":"Contacts data saved","cost":"Price","count":"Qty","current_accumulated_discount":"Currently accumulated discount","customer_field":"Customer","customer_pickup":"Customer Pickup","date":"Date","deliveries_not_available":"No shipping methods available.","delivery":"Shipping","delivery_address":"Shipping address","delivery_choice":"Shipping","delivery_details":"Details","delivery_interval":{"from":"from","title":"Delivery time","to":"to"},"delivery_method":"Shipping method","delivery_price":"Delivery cost","description":"Description","discount":"Discount","discounts_and_bonuses":"Discounts","discounts_title":"Discounts and Bonuses","edit":"edit","email":"E-mail","empty_orders_message":"You don't have any completed orders so far!","enter":"Enter","enter_client_room":"Access your account","enter_email":"Enter e-mail","exit":"Exit","feedback_client_email_label":"Feedback e-mail","feedback_content_label":"Your questions, remarks and wishes","feedback_default_subject":"Message for the store visitors","feedback_description":"You will be contacted via e-mail or by phone specified in your account.","feedback_form_title":"Feedback form","feedback_sent":"Message successfully sent.","feedback_title":"Feedback","field":{"address":"Address","bank_name":"Bank name","bik":"BIK","city":"City","click_for_select":"Click to select","consent_to_personal_data":"Agreement to personal data processing","country":"Country","delivery_location_not_valid":"Error! Locality could not be detected. Shipping details can be different for mentioned location. Start typing your locality name and select the correct menu.","email":"E-mail","email_confirmation":"Confirm \u003Cnobr\u003EE-mail\u003C/nobr\u003E","flat":"Flat","full_locality_name":"Locality","house":"House","inn":"INN","juridical_address":"Company address","middlename":"Middlename","move_file_or_click":"Drag a file here or click to select","name":"Contact person","not_filled":"The field is not filled","phone":"Phone number","state":"State","street":"Street","subscribe":"Subscribe to news","surname":"Surname","zip":"Postal/ZIP Code"},"flash":{"fail":"An error occurred!","payment_needed":"Order successfully created. In few seconds you will be redirected to checkout.","thanks":"Thanks for the order!"},"for_new_clients":"For new clients","for_order_summ":"for order total greater than","for_registered_clients":"For registered clients","go_back":"Back","go_forward":"Continue","go_pay":"Proceed to checkout","go_to_orders":"Go back to orders","go_to_registration":"Register new account","go_to_shop":"Go to the shop","have_account":"I already have an account","information_is_sent_by_email":"Order information was sent to your e-mail","language":"Language","layouts":{"shops":{"checkout2":{"cart":"Shopping cart"}}},"link_to_password_change":"Link for password change was sent on your e-mail","login_fail":"Login and password you entered did not match each other","login_throug":"Authorization with social media","login_through":"or login with","margin":"Payment service charge","max_bonus_points":"Maximum","name":"Items","next_level_discount":"Nearest discount is","no_delivery":"Shipping not requested","order":"Order","order_content":"Order summary","order_info":"Order info","order_missing":"Specified e-mail not found","order_number":"Order №","order_payment":"Order payment","order_status":"Order status","ordering":"Checkout","orders":{"complete_orders_amount":"Completed orders","order_amount":"Order total","order_date":"Order date","order_number":"Order number","order_payment":"Payment","order_status":"Status"},"orders_history":"Orders history","orders_history_title":"Order history","orders_title":"Orders and discounts","paid_status":{"false":"not paid","true":"paid"},"password":"Password","password_change_request_expired":"Your password change request was expired. Please, repeat your password regeneration request once again.","password_changing":"Password change","password_confirmation":"Repeat password","password_confirmation_no_match":"Password confirmation did not match with the password.","payment_choice":"Payment","payment_confirmation":"Payment confirmation","payment_status":"Payment status","payment_way":"Payment method","payments_not_available":"There are no payment methods for selected shipping method","paypal_confirm_info":"You have set PayPal as your payment method. You need to approve the transaction for your order to be processed.","price_without_delivery":"price without shipping","print_receipt":"Proceed to checkout (print payment receipt)","products":{"one":"1 product","other":"%{count} products"},"products_subtotal":"Items:","quick_login_registration":"Quick login/registration","recipient":"Recipient","recipient_field":"Recipient","recipients_phone":"Recipient's phone","register":"Register","register_me_on_this_site":"Please create my account","registered_client_advantages":"You will be able to view your order history, take advantage of a faster shopping experience and get exclusive discounts","registration_title":"Register new account","reload_captcha":"Reload image","remember_password_link":"I got the password!","restore_password":"Password regeneration","save":"Save changes","send":"Send feedback","set_password":"To set new password","shop_title":"Continue shopping","sku":"SKU","step":"Step","sum_and_status":"Total and status","summary":"Order summary","total":"Total","use_all_bonus_points":"Spend all","use_bonus_points":"Use bonus points to pay","user":"Username","using_service":"The Storefront is made via %{service_name} service","warnings":{"deliveries":"Shipping","deliveries_not_available":"There are no shipping options assigned to payment methods.","delivery_settings":"You can edit shipping options in section Settings","page_title":"Store settings are incorrect!","payment_settings":"You can edit payment options in section Settings","payments":"Payments"},"wrong_email":"Wrong e-mail","your_order":"Your order"},"widgets":{"widget_add":"add widget","widget_destroy":"delete","widget_destroy_confirm":"Delete widget?","widget_down":"move down","widget_edit":"edit","widget_empty":"widget doest not contain blocks","widget_hide":"hide","widget_show":"show","widget_up":"move up"}}},"ru":{"number":{"currency":{"format":{"delimiter":" ","format":"%n %u","precision":2,"separator":",","significant":false,"strip_insignificant_zeros":false,"unit":"руб."}},"format":{"delimiter":" ","precision":3,"separator":",","significant":false,"strip_insignificant_zeros":false},"human":{"decimal_units":{"format":"%n %u","units":{"billion":{"few":"миллиардов","many":"миллиардов","one":"миллиард","other":"миллиардов"},"million":{"few":"миллионов","many":"миллионов","one":"миллион","other":"миллионов"},"quadrillion":{"few":"квадриллионов","many":"квадриллионов","one":"квадриллион","other":"квадриллионов"},"thousand":{"few":"тысяч","many":"тысяч","one":"тысяча","other":"тысяч"},"trillion":{"few":"триллионов","many":"триллионов","one":"триллион","other":"триллионов"},"unit":""}},"format":{"delimiter":"","precision":1,"significant":false,"strip_insignificant_zeros":false},"storage_units":{"format":"%n %u","units":{"byte":{"few":"байта","many":"байт","one":"байт","other":"байта"},"gb":"ГБ","kb":"КБ","mb":"МБ","tb":"ТБ"}}},"percentage":{"format":{"delimiter":""}},"precision":{"format":{"delimiter":""}},"quantity":"шт.","weight":{"mili":{"few":"гр","many":"гр","one":"гр","other":"гр","zero":"гр"},"unit":{"few":"кг","many":"кг","one":"кг","other":"кг","zero":"кг"}}},"shop":{"common_js":{"compare":"Сравнить","max_products":"Сравнивать можно не более 4-х товаров","product_added":"Товар добавлен в корзину","product_added_for_compare":"Товар добавлен к сравнению","product_already_added":"Этот товар уже добавлен"},"find":"Найти","order_registration":{"account":"Личный кабинет","accumulated_discount_title":"Накопленная скидка","additional_info":"Дополнительная информация","address_updated":"Адрес доставки сохранен","addresses_title":"Адрес доставки","already_client":"Уже покупали у нас?","antibot_protection":"Защита от автоматических регистраций","authorized_as":"Вы авторизовались как","barcode":"Штрих-код","bonus":{"reason":"Основание"},"bonus_balance":"Баланс бонусов","bonus_history":"История списания и начисления бонусов","bonuses":"Бонусы","captcha_label":"Наберите текст, изображённый на картинке выше","change_default_address":"Изменить адрес \"по умолчанию\"","change_password":"Сменить пароль","check_checkout_data":"Проверьте введённые данные и подтвердите заказ","client_bonus_points_html":{"few":"У вас есть \u003Cb\u003E%{count}\u003C/b\u003E балла.","many":"У вас есть \u003Cb\u003E%{count}\u003C/b\u003E баллов.","one":"У вас есть \u003Cb\u003E%{count}\u003C/b\u003E балл."},"client_bonus_points_question":"Сколько хотите потратить?","client_discount_title":"Персональная скидка","client_room_title":"Кабинет покупателя","comment":"Комментарии к заказу","confirm":"Подтвердить заказ","confirm_payment":"Подтвердить оплату","confirmation":"Подтверждение","contact_details":"Контактные данные","contacts":"Контакты","contacts_title":"Контактные данные","contacts_updated":"Контактные данные сохранены","cost":"Стоимость","count":"Кол-во","current_accumulated_discount":"Текущая накопленная скидка","customer_field":"Покупатель","customer_pickup":"Самовывоз","date":"Дата","deliveries_not_available":"Для данного населенного пункта нет подходящих способов доставки","delivery":"Доставка","delivery_address":"Адрес доставки","delivery_choice":"Способ доставки","delivery_details":"Подробнее","delivery_interval":{"from":"от","title":"Срок доставки","to":"до"},"delivery_method":"Способ доставки","delivery_price":"Стоимость доставки","description":"Описание","discount":"Скидка","discounts_and_bonuses":"Скидки и бонусы","discounts_title":"Скидки и Бонусы","edit":"редактировать","email":"E-mail","empty_orders_message":"Вы не сделали ещё ни одного заказа","enter":"Войти","enter_client_room":"Вход в кабинет покупателя","enter_email":"Введите e-mail","exit":"Выход","external_login":"Внешняя авторизация для %{back_url}","feedback_client_email_label":"e-mail для обратной связи","feedback_content_label":"Ваш вопрос, отзыв или пожелание","feedback_default_subject":"Сообщение посетителя магазина","feedback_description":"Ответ магазина поступит на e-mail или телефон, указанный в контактных данных.","feedback_form_title":"Форма обратной связи с магазином","feedback_sent":"Сообщение успешно отправлено.","feedback_title":"Обратная связь","field":{"address":"Адрес","bank_name":"Название банка","bik":"БИК","city":"Город/Район","click_for_select":"Кликните для выбора","consent_to_personal_data":"Согласие на обработку персональных данных","country":"Страна","delivery_location_not_valid":"Ошибка! Не удалось определить населенный пункт. Виды и стоимости доставок могут не соответствовать указанному населенному пункту. Чтобы исправить, начните вводить населенный пункт и выберите из появившейся подсказки.","email":"E-mail","email_confirmation":"Подтверждение E-mail","file_selected":"Выбран файл","flat":"Квартира","full_locality_name":"Населенный пункт","house":"Дом","inn":"ИНН","juridical_address":"Юридический адрес","middlename":"Отчество","move_file_or_click":"Перенесите сюда файл или кликните для выбора","name":"Контактное лицо (ФИО)","not_filled":"Поле не заполнено","phone":"Контактный телефон","state":"Регион","street":"Улица","subscribe":"Подписаться на новости магазина","surname":"Фамилия","zip":"Почтовый индекс"},"flash":{"fail":"Произошла ошибка","payment_needed":"Заказ успешно оформлен. В течение нескольких секунд вы будете перенаправлены на страницу оплаты.","thanks":"Спасибо за заказ!"},"for_new_clients":"Для новых покупателей","for_order_summ":"при  достижении суммы","for_registered_clients":"Для постоянных покупателей","go_back":"Вернуться","go_forward":"Продолжить","go_pay":"Перейти к оплате","go_to_orders":"Вернуться к заказам","go_to_registration":"Зарегистрироваться","go_to_shop":"Перейти в магазин","have_account":"У меня уже есть аккаунт","information_is_sent_by_email":"На указанный вами адрес электронной почты отправлено сообщение со всей необходимой информацией.","language":"Язык","layouts":{"shops":{"checkout2":{"cart":"Корзина"}}},"link_to_password_change":"Ссылка на смену пароля отправлена на указанный адрес","login_fail":"Сочетание логина и пароля не подходит","login_throug":"Авторизация через соцсети","login_through":"или войти через","margin":"Наценка на способ оплаты (включена в стоимость)","max_bonus_points":"Максимум","name":"Наименование","next_level_discount":"Ближайший уровень","no_delivery":"Доставка не требуется","order":"Заказ","order_content":"Состав заказа","order_info":"Информация о заказе","order_missing":"Указанный заказ не найден","order_number":"Заказ №","order_payment":"Оплата заказа","order_status":"Статус заказа","ordering":"Оформление заказа","orders":{"complete_orders_amount":"Сумма выполненных заказов","order_amount":"Сумма заказа","order_date":"Дата оформления","order_number":"Номер заказа","order_payment":"Оплата","order_status":"Статус"},"orders_history":"История заказов","orders_history_title":"История заказов","orders_title":"Заказы и скидки","outlet_address":"Адрес точки самовывоза","paid_status":{"false":"Не оплачен","true":"Оплачен"},"password":"Пароль","password_change_request_expired":"Ваш запрос на смену пароля устарел, восстановите пароль повторно","password_changing":"Изменение пароля","password_confirmation":"Повторите пароль","password_confirmation_no_match":"Пароль не совпадает с подтверждением","payment_choice":"Способ оплаты","payment_confirmation":"Подтверждение оплаты","payment_status":"Статус оплаты","payment_way":"Способ оплаты","payments_not_available":"Для данного способа доставки нет подходящих способов оплаты","paypal_confirm_info":"Вы настроили оплату через систему PayPal. Необходимо подтвердить оплату, чтобы заказ поступил в обработку.","price_without_delivery":"без учёта доставки","print_receipt":"Перейти к оплате (распечатать квитанцию)","products":{"few":"%{count} товара","many":"%{count} товаров","one":"%{count} товар","other":"%{count} товар"},"products_subtotal":"Сумма по товарам","quick_login_registration":"Быстрый вход/регистрация","recipient":"Получатель (ФИО)","recipient_field":"Получатель","recipients_phone":"Телефон получателя","register":"Зарегистрировать","register_me_on_this_site":"Стать постоянным покупателем","registered_client_advantages":"Вы сможете видеть историю заказов, проще делать новые и получать скидки","registration_title":"Регистрация","reload_captcha":"Обновить изображение","remember_password_link":"Я вспомнил пароль!","restore_password":"Восстановить пароль","save":"Сохранить изменения","send":"Отправить","set_password":"Установить пароль","shop_title":"Вернуться в магазин","sku":"Артикул","step":"Шаг","sum_and_status":"Сумма и статус","summary":"Итого","total":"Итого","use_all_bonus_points":"Потратить все","use_bonus_points":"Использовать бонусы при оплате","user":"Пользователь","using_service":"Интернет-магазин организован при помощи сервиса %{service_name}","warnings":{"deliveries":"Доставки","deliveries_not_available":"Нет ни одного настроенного способа доставки с привязанными к нему оплатами.","delivery_settings":"Настроить доставки вы можете в разделе Настройки","page_title":"Ошибка в настройках интернет-магазина!","payment_settings":"Настроить оплаты вы можете в разделе Настройки","payments":"Оплаты"},"wrong_email":"Неправильный e-mail","your_order":"Ваш заказ"},"widgets":{"widget_add":"добавить виджет","widget_destroy":"удалить","widget_destroy_confirm":"Удалить виджет?","widget_down":"переместить вниз","widget_edit":"редактировать","widget_empty":"вижет не содержит блоков","widget_hide":"скрыть","widget_show":"показать","widget_up":"переместить вверх"}}},"ua":{"number":{"currency":{"format":{"delimiter":",","format":"%u %n","precision":2,"separator":".","unit":"$"}},"format":{"delimiter":",","precision":3,"separator":"."}},"shop":{"find":"Знайти","order_registration":{"account":"Особистий кабінет","accumulated_discount_title":"Накопичена знижка","additional_info":"Додаткова інформація","address_updated":"Адрес доставки сохранен","addresses_title":"Адрес доставки","already_client":"Вже купували в нас?","antibot_protection":"Защита от автоматических регистраций","as_client":"як клієнт","authorized_as":"Ви авторизувалися як","bonus":{"reason":"Причина"},"bonuses":"Бонуси","captcha_label":"Наберите текст, изображённый на картинке выше","change_password":"Змінити пароль","check_checkout_data":"Перевірте введену інформацію та надайте підтвердження замовлення","client_discount_title":"Персональна знижка","client_room_title":"Кабінет покупця","comment":"Комментарі","confirm":"Підтверджую замовлення","confirm_payment":"Подтвердить оплату","confirmation":"Підтвердження","contacts":"Контакти","contacts_title":"Контактні дані","contacts_updated":"Контактні дані збережено","cost":"Вартість","count":"К-сть","current_accumulated_discount":"Поточна накопичена знижка","customer_field":"Покупець","customer_pickup":"самовивіз","date":"Дата","delivery":"Доставка","delivery_address":"Адреса доставки","delivery_choice":"Вибір доставки","delivery_method":"Спосіб доставки","delivery_price":"Вартість доставки","description":"Опис","discount":"Знижка","edit":"редагувати","empty_orders_message":"Ви ще не зробили жодного замовлення","enter":"Увійти","enter_client_room":"Вхід в кабінет покупця","enter_email":"Введіть адресу електронної пошти","exit":"Вихід","feedback_client_email_label":"e-mail для зворотнього зв´язку","feedback_content_label":"Ваше запитання, відгук чи побажання","feedback_default_subject":"Повідомлення відвідувача магазину","feedback_description":"Відповідь магазину відбудеться по e-mail або телефону, що вказані в контактних даних","feedback_form_title":"Форма зворотнього зв´язку з магазином","feedback_sent":"Повідомлення успішно відправлено.","feedback_title":"Зворотній зв´язок","field":{"address":"Адреса","city":"Місто","country":"Країна","email":"Електронна пошта","email_confirmation":"Пiдтвердити \u003Cnobr\u003EE-mail\u003C/nobr\u003E","flat":"Квартира","full_locality_name":"Населений пункт","house":"Будинок","middlename":"По батькові","name":"Контактна особа","phone":"Телефон для зв’язку","state":"Область","street":"Вулиця","subscribe":"Підписатися на новини магазину","surname":"Прізвище","zip":"Поштовий індекс"},"flash":{"fail":"Виникла помилка","payment_needed":"Замовлення успішно оформлено. Протягом декількох секунд ви будете перенаправлені на сторінку оплати.","thanks":"Дякуємо за замовлення!"},"for_new_clients":"Для нових покупців","for_order_summ":"при досягненій сумі","for_registered_clients":"Для постійних покупців","go_back":"Повернутися","go_forward":"Продовжити","go_pay":"Перейти до оплати","go_to_orders":"Повернутися до замовлень","go_to_registration":"Зареєструватися","go_to_shop":"Перейти в магазин","information_is_sent_by_email":"На вказану вами адресу електронної пошти буде відправлено повідомлення з усією необхідною інформацією.","language":"Мова","link_to_password_change":"Лінк для зміни пароля відправлений на вказану адресу","log_in":"Увійдіть","login_fail":"Таке поєднання логіна та пароля логина и пароля невірне","login_through":"або увійти через","margin":"Націнка на спосіб оплати","name":"Найменування","next_level_discount":"Найближчий рівень","no_delivery":"Доставка не портібна","order":"Замовлення","order_content":"Склад замовлення","order_missing":"Вказане замовлення не знайдено","order_number":"Замовлення №","order_payment":"Оплата замовлення","order_status":"Статус замовлення","ordering":"Оформлення замовлення","orders":{"complete_orders_amount":"Сума виконаних замовлень","order_amount":"Сума замовлення","order_date":"Дата оформлення","order_number":"Номер замовлення","order_payment":"Оплата","order_status":"Статус"},"orders_history_title":"Історія замовлень","orders_title":"Замовлення та знижки","paid_status":{"false":"не оплачений","true":"оплачений"},"password":"Пароль","password_change_request_expired":"Ваш запит на зміну пароля - застарілий, відновити пароль повторно","password_changing":"Зміна пароля","password_confirmation":"Ще раз пароль","password_confirmation_no_match":"Пароль не збігається з підтвердженням","payment_choice":"Вибір оплати","payment_confirmation":"Підтвердження оплати","payment_status":"Статус оплати","payment_way":"Спосіб оплати","paypal_confirm_info":"Ви налаштували оплату через систему PayPal. Необхідно підтвердити оплату, щоб замовлення поступило в обробку.","price_without_delivery":"не враховуючи доставку","print_receipt":"Перейти до оплати (роздрукувати квитанцію)","products":{"few":"%{count} товари","many":"%{count} товарів","one":"%{count} товар","other":"%{count} товар"},"products_subtotal":"Сума по товарах","quick_login_registration":"швидкий вхід / реєстрація","recipient":"Отримувач","recipient_field":"Отримувач","recipients_phone":"Телефон отримувача","register":"Зареєструвати","register_me_on_this_site":"Зареєструвати мене на сайті","registered_client_advantages":"Ви зможете бачити історію замовлень, простіше робити покупки та отримувати знижки","registration_title":"Реєстрація","reload_captcha":"Обновить изображение","restore_password":"Відновити пароль","save":"Зберегти зміни","send":"Надіслати","set_password":"Встановити пароль","shop_title":"Повернутися до магазину","sku":"Артикул","step":"Крок","summary":"Підсумок","total":"Підсумок","user":"Користувач","using_service":"Інтернет-магазин створений за допомогою сервіса %{service_name}","wrong_email":"Невірний e-mail","your_order":"Ваше замовлення"}}},"kz":{"shop":{"common_js":{"compare":"Салыстыру","max_products":"Салыстыруға 4 тауардан артық болмайды","product_added":"Тауар себетке қосылды","product_added_for_compare":"Тауар салыстыруға қосылды","product_already_added":"Бұл тауар қосылып қойған"},"find":"Табу","order_registration":{"account":"Жеке кабинет","accumulated_discount_title":"Жинақталған жеңілдік","additional_info":"Қосымша ақпарат","address_updated":"Жеткізу мекен-жайы сақталды","addresses_title":"Жеткізу мекен-жайы","antibot_protection":"Автоматты тіркелулерден сақтау","bonus":{"reason":"Негізі"},"bonuses":"Бонустар","captcha_label":"Жоғарыда, суретте көрсетілген мәтінді теріңіз","change_default_address":"Мекен-жайды 'сөзсіз' өзгерту","change_password":"Кілтсөзді ауыстыру","check_checkout_data":"Енгізілген мәліметтерді тексеріп, тапсырысты растаңыз","client_bonus_points_html":{"few":"Сізде \u003Cb\u003E%{count}\u003C/b\u003E балл бар.","many":"Сізде \u003Cb\u003E%{count}\u003C/b\u003E балл бар.","one":"Сізде \u003Cb\u003E%{count}\u003C/b\u003E балл бар."},"client_bonus_points_question":"Қанша жаратқыңыз келеді?","client_discount_title":"Жеке жеңілдік","client_room_title":"Сатып алушының кабинеті","comment":"Тапсырысқа қатысты пікірлер","confirm":"Тапсырысты растау","confirm_payment":"Төлемді растау","confirmation":"Растау","contacts":"Байланыс мәліметі","contacts_title":"Байланыс мәліметтері","contacts_updated":"Байланыс мәліметтері сақталды","cost":"Бағасы","count":"Саны","current_accumulated_discount":"Ағымдағы жинақталған жеңілдік","date":"Күні","deliveries_not_available":"Жеткізудің еш түрі қол жетімсіз!!","delivery":"Жеткізу","delivery_address":"Жеткізу мекен-жайы","delivery_choice":"Жеткізудің тәсілі","delivery_method":"Жеткізу тәсілі","description":"Сипаттама","discount":"Жеңілдік","edit":"өңдеу","empty_orders_message":"Сіз әлі бірде бір тапсырыс жасаған жоқсыз","enter":"Кіру","enter_client_room":"Сатып алушының кабинетіне кіру","enter_email":"Е-mail енгізіңіз","exit":"Шығу","feedback_client_email_label":"Кері байланыс үшін e-mail","feedback_content_label":"Сіздің сұрағыңыз, пікіріңіз және тілегіңіз","feedback_default_subject":"Дүкенге келуші үшін хабарландыру","feedback_description":"Дүкеннің жауабы  байланыс мәліметтерінде көрсетілген e-mail немесе телефонға келеді.","feedback_form_title":"Дүкенмен кері байланыс пішіні","feedback_sent":"Хабарландыру сәтті жеткізілді.","feedback_title":"Кері байланыс","field":{"address":"Мекен- жай","city":"Қала/аудан","country":"Ел","email":"E-mail","email_confirmation":"Растау \u003Cnobr\u003EE-mail\u003C/nobr\u003E","middlename":"Әкесінің аты","name":"Байланыс тұлғасы (ТАӘ)","phone":"Байланыс телефоны","phone_example":"Мысалы: +7(727)111-11-11","state":"Аймақ","subscribe":"Дүкен жаңалықтарына жазылу","surname":"Тегі","zip":"Пошта индексі"},"flash":{"fail":"Қате кетті","thanks":"Тапсырысыңызға рахмет!"},"for_new_clients":"Жаңа сатып алушылар үшін","for_order_summ":"сомасына жеткенде","for_registered_clients":"Тұрақты сатып алушылар үшін","go_back":"Қайту","go_forward":"Жалғастыру","go_pay":"Төлемге өту","go_to_orders":"Тапсырыстарға қайта оралу","go_to_registration":"Тіркелу","go_to_shop":"Дүкенге өту","information_is_sent_by_email":"Сіз көрсеткен электронды мекен-жайға барлық қажетті мәліметпен хабарландыру жіберілді.","language":"Тіл","link_to_password_change":"Кілтсөзді ауыстыру сілтемесі көрсетілген мекен-жайға жіберілді","login_fail":"Логин мен кілтсөз ұйқасы сәйкес келмейді","login_through":"Немесе …. арқылы кіру","margin":"Төлем тәсіліне үстеме баға (бағасына қосылған)","max_bonus_points":"Максимум","name":"Атауы","next_level_discount":"Ең жақын деңгей","no_delivery":"Жеткізу талап етілмейді","order":"Тапсырыс","order_content":"Тапсырыстың құрамы","order_missing":"Көрсетлген тапсырыс табылмады","order_number":"Тапсырыс №","order_payment":"Тапсырысты төлеу","order_status":"Тапсырыс статусы","ordering":"Тапсырысты рәсімдеу","orders":{"complete_orders_amount":"Іске асырылған тапсырыстар сомасы","order_amount":"Тапсырыс сомасы","order_date":"Рәсімдеу күні","order_number":"Тапсырыс нөмірі","order_payment":"Төлем","order_status":"Статус"},"orders_history_title":"Тапсырстар тарихы","orders_title":"Тапсырыстар және жеңілдіктер","paid_status":{"false":"төленбеді","true":"төленді"},"password":"Кілтсөз","password_change_request_expired":"Сіздің кілтсөзді ауыстыру сұрансыңыз ескірді, кілтсөзді қайталап қалпына келтіріңіз","password_changing":"Кілсөзді өзгерту","password_confirmation":"Кілтсөзді қайталаңыз","payment_choice":"Төлем тәсілі","payment_confirmation":"Төлемді растау","payment_status":"Төлем статусы","payment_way":"Төлем тәсілі","paypal_confirm_info":"Сіз төлемді  PayPal жүйесі арқылы төлеуді баптадыңыз. Тапсырыс қарастырылуы үшін, төлемді растау керек.","price_without_delivery":"жеткізуді қоспағанда","print_receipt":"Төлемге өту (түбертекті басып шығару)","products":{"few":"%{count} тауар","many":"%{count} тауар","one":"%{count} тауар","other":"%{count} тауар"},"quick_login_registration":"Тез кіру/тіркелу","recipient":"Қабылдаушы (ТАӘ)","recipients_phone":"Қабылдаушының телефоны","register":"Тіркеу","register_me_on_this_site":"Тұрақты сатып алушы болу","registered_client_advantages":"Сіз тапсырыстар тарихын көре аласыз, жаңасын жасау және жеңілдік алу оңайырақ","registration_title":"Тіркелу","reload_captcha":"Суретті жаңартыңыз","restore_password":"Кілтсөзді қалпына келтіру","save":"Өзгертулерді сақтау","send":"Жіберу","set_password":"Кілтсөз орнату","shop_title":"Дүкенге қайта оралу","sku":"Артикул","step":"Қадам","successful":{"created":"Тапсырыс сәтті рәсімделді","go_to_main_page":"Егер Сіз сатып алушы болып, бұл бетке кездейсоқ кіріп қалсаңыз, дүкеннің басты бетіне өтіңіз","go_to_next_step":"Сіз автоматты түрде тапсырысты рәсімдеудің келесі қадамына бағытталасыз, егер ол болмаса, келесі сілтеме бойынша өтіңіз","system_page":"Бұл сәтті рәсімделген тапсырыстың қызмет парақшасы."},"summary":"Жалпы сомасы","total":"Жалпы сомасы","use_all_bonus_points":"Барлығын жарату","use_bonus_points":"Төлем кезінде бонусты қолдану","user":"Қолданушы","using_service":"Интернет-дүкен %{service_name} қызметі көмегімен ұйымдастырылған","warnings":{"deliveries":"Жеткізу","deliveries_not_available":"Бапталған бірде-бір жеткізу тәсілі, оған байланысты төлемдер жоқ.","delivery_settings":"Жеткізулерді Сіз Баптау бөлімінде баптай аласыз","page_title":"Интернет-дүкеннің баптауларында қате кетті!","payment_settings":"Төлемдерді Сіз Баптау бөлімінде баптай аласыз","payments":"Төлемдер"},"wrong_email":"Қате  e-mail","your_order":"Сіздің тапсырысыңыз"}}},"az":{"number":{"currency":{"format":{"delimiter":",","format":"%u %n","precision":2,"separator":".","unit":"$"}},"format":{"delimiter":",","precision":3,"separator":"."}},"shop":{"find":"Find","order_registration":{"account":"Şəxsi kabinet","accumulated_discount_title":"Toplanmış endirim","additional_info":"Əlavə məlumat","address_updated":"Çatdırılma ünvanı yaddaşa daxil edilmişdir","addresses_title":"Çatdırılma ünvanı","antibot_protection":"Mexaniki qeydiyyatlardan mühafizə","bonus":{"reason":"Reason"},"bonuses":"Bonuses","captcha_label":"Yuxarıdakı şəkildə təsvir edilən mətni daxil edin","change_password":"Şifrəni dəyişin","check_checkout_data":"Daxil edilən məlumatları nəzərdən keçirin və sifarişi təsdiq edin","client_discount_title":"Şəxsi endirim","client_room_title":"Alıcı kabineti","comment":"Sifarişə aid qeydlər","confirm":"Sifarişi təsdiq edin","confirm_payment":"Ödəmənin təsdiqi","confirmation":"Təsdiq","contacts":"Əlaqələr","contacts_title":"Əlaqə məlumatı","contacts_updated":"Əlaqə məlumatları yaddaşa daxil edilmişdir","cost":"Qiyməti","count":"Sayı","current_accumulated_discount":"Cari toplanmış endirim","date":"Date","delivery":"Çatdırılma","delivery_address":"Çatdırılma ünvanı","delivery_choice":"Çatdırılma üsulları","delivery_method":"Çatdırılma üsulu","description":"Description","discount":"Endirim","edit":"Redaktə edin","empty_orders_message":"Siz hələ heç bir sifariş etməmisiniz","enter":"Daxil olun","enter_client_room":"Alıcı kabinetinə giriş","enter_email":"Elektron ünvani daxil edin","exit":"Çıxış","feedback_client_email_label":"Əlaqə saxlamaq üçün elektron ünvan","feedback_content_label":"Sizin sualınız, rəyiniz və ya arzunuz","feedback_description":"Mağazanın cavabı əlaqə məlumatlarında daxil edilən elektron ünvanına vəya telefon nömrəsinə göndəriləcəkdir","feedback_form_title":"Mağaza ilə əlaqə saxlamaq üçün forma","feedback_sent":"İsmarış uğurla göndərilmişdir","feedback_title":"Əlaqə","field":{"address":"Ünvan","city":"Şəhər","country":"Ölkə","email":"Elektron ünvan","email_confirmation":"Təsdiq \u003Cnobr\u003EE-mail\u003C/nobr\u003E","middlename":"Atasının adı","name":"Əlaqə şəxsi (Adı, soyadı, atasının adı)","phone":"Əlaqə telefonu","state":"Bölgə","subscribe":"Mağazanın xəbərlərinə abunə olun","surname":"Soyad","zip":"Poçt indeksi"},"flash":{"fail":"Səhvə yol verilmişdir","thanks":"Sifariş etdiyinizə görə minnətdarıq!"},"for_new_clients":"Yeni alıcılar üçün","for_order_summ":"при  досягненій сумі","for_registered_clients":"Daimi alıcılar üçün","go_back":"Geriyə","go_forward":"Davam edin","go_pay":"Ödəməyə keçin","go_to_orders":"Sifarişlərə qayıdın","go_to_registration":"Qeydiyyatdan keçin","go_to_shop":"Mağazaya keçin","information_is_sent_by_email":"Daxil etdiyiniz elektron ünvanına bütün lazımi məlumat göndərilmişdir.","language":"Dil","link_to_password_change":"Şifrənin dəyişdirilməsi linki göstərilmiş elektron ünvana göndərilmişdir","login_fail":"Login və şifrə uyğun gəlmir","margin":"Payment service charge","name":"Adı","next_level_discount":"Найближчий рівень","no_delivery":"Çatdırılma tələb olunmur","order":"Sifariş","order_content":"Sifarişin tərkibi","order_missing":"Daxil edilən sifariş tapılmamışdır","order_number":"Sifariş №","order_payment":"Sifarişin ödənilməsi","order_status":"Sifarişin statusu","ordering":"Sifarişin hazırlanması","orders":{"complete_orders_amount":"Yerinə yetirilmiş sifarişlərin məbləği","order_amount":"Sifarişin məbləği","order_date":"Rəsmiləşdirmə tarixi","order_number":"Sifarişin nömrəsi","order_payment":"Ödəniş","order_status":"status"},"orders_history_title":"Sifarişlərin tarixi","orders_title":"Sifariş və endirimlər","paid_status":{"false":"Ödənilməmişdir","true":"Ödənilmişdir"},"password":"Şifrə","password_change_request_expired":"Sizin şifrənin dəyişdirilməsinə dair müraciətinizin vaxtı keçmişdir, şifrənizi yenidən bərpa edin.","password_changing":"Şifrənin dəyişdirilməsi","password_confirmation":"Şifrəni təkrar edin","payment_choice":"Ödəmə üsulları","payment_confirmation":"Ödəmənin təsdiq edilməsi","payment_status":"Ödəmənin statusu","payment_way":"Ödəmə üsulu","paypal_confirm_info":"Siz ödəməni PayPal vasitəsilə həyata keçirilməsini seçdiniz. Sifarişinizin hazırlanması üçün ödəmə təsdiq edilməlidir","price_without_delivery":"Çatdırılma nəzərə alınmadan","print_receipt":"Ödəməyə keçin (qəbzi çap edin)","products":{"few":"%{count} Məhsulun","many":"%{count} Məhsulların","one":"%{count} Məhsul","other":"%{count} Məhsul"},"quick_login_registration":"Sadə giriş/qeyd","recipient":"Qəbul edən (Adı, soyadı, atasının adı)","recipients_phone":"Qəbul edən şəxsin telefon nömrəsi","register":"Qeydiyyatdan keçirin","register_me_on_this_site":"Daimi alıcı olun","registered_client_advantages":"Siz sifarişlərin tarixini görəcək, asanlıqla yeni sifarişlər və endirimlər əldə edəcəksiniz","registration_title":"Qeydiyyat","reload_captcha":"Təsviri yeniləyin","restore_password":"Şifrəni bərpa edin","save":"Dəyişiklikləri yaddaşa verin","send":"Göndərin","set_password":"Şifrənin bərpası","shop_title":"Mağazaya qayıdın","sku":"Artikul","step":"Addım","summary":"Yekun","total":"Total","user":"İstifadəçi","using_service":"İnternet – mağaza xidmət vasitəsilə təşkil edilmişdir %{service_name}","wrong_email":"Yanlış elektron ünvan","your_order":"Sizin sifarişiniz"}}},"vi":{"number":{"currency":{"format":{"delimiter":",","format":"%u %n","precision":2,"separator":".","significant":false,"strip_insignificant_zeros":false,"unit":"$"}},"format":{"delimiter":",","precision":3,"separator":".","significant":false,"strip_insignificant_zeros":false},"human":{"decimal_units":{"format":"%n %u","units":{"billion":{"one":"billion","other":"billions"},"million":{"one":"million","other":"millions"},"quadrillion":{"one":"quadrillion","other":"quadrillions"},"thousand":{"one":"thousand","other":"thousands"},"trillion":{"one":"trillion","other":"trillions"},"unit":""}},"format":{"delimiter":"","precision":1,"significant":true,"strip_insignificant_zeros":true},"storage_units":{"format":"%n %u","units":{"byte":{"few":"Bytes","many":"Bytes","one":"Byte","other":"Bytes"},"gb":"GB","kb":"KB","mb":"MB","tb":"TB"}}},"percentage":{"format":{"delimiter":""}},"precision":{"format":{"delimiter":""}},"quantity":"pcs.","weight":{"mili":{"one":"gr","other":"gr","zero":"gr"},"unit":{"one":"kg","other":"kg","zero":"kg"}}},"shop":{"common_js":{"compare":"Compare","max_products":"You can compare not more than 4 products at once","product_added":"Product added","product_added_for_compare":"Product selected to compare","product_already_added":"This product is already added"},"find":"Find","order_registration":{"account":"Your account","accumulated_discount_title":"Accumulated discount points","additional_info":"Additional info","address_updated":"Shipping address saved","addresses_title":"Shipping address","antibot_protection":"Automatic registration protection","barcode":"Barcode","bonus":{"reason":"Reason"},"bonuses":"Bonuses","captcha_label":"Type the text from the image above","change_default_address":"Change default address","change_password":"Change password","check_checkout_data":"Please check order details and confirm to proceed to checkout","client_bonus_points_html":{"one":"You have \u003Cb\u003E%{count}\u003C/b\u003E point.","other":"You have \u003Cb\u003E%{count}\u003C/b\u003E points."},"client_bonus_points_question":"How much would you like to spend?","client_discount_title":"Personal discount points","client_room_title":"Buyer account","comment":"Comments","confirm":"Place my order!","confirm_payment":"Confirm payment","confirmation":"Confirmation","contacts":"Contacts","contacts_title":"Personal data","contacts_updated":"Contacts data saved","cost":"Price","count":"Qty","current_accumulated_discount":"Currently accumulated discount","date":"Date","deliveries_not_available":"No shipping methods available!","delivery":"Shipping","delivery_address":"Shipping address","delivery_choice":"Shipping","delivery_method":"Shipping method","description":"Description","discount":"Discount","edit":"edit","empty_orders_message":"You don't have any completed orders so far!","enter":"Enter","enter_client_room":"Access your account","enter_email":"Enter e-mail","exit":"Exit","feedback_client_email_label":"Feedback e-mail","feedback_content_label":"Your questions, remarks and wishes","feedback_default_subject":"Message for the store visitors","feedback_description":"You will be contacted via e-mail or by phone specified in your account.","feedback_form_title":"Feedback form","feedback_sent":"Message successfully sent.","feedback_title":"Feedback","field":{"address":"Address","city":"City","country":"Country","email":"E-mail","email_confirmation":"Repeat \u003Cnobr\u003EE-mail\u003C/nobr\u003E","middlename":"Middlename","name":"Contact person","phone":"Phone number","state":"State","subscribe":"Subscribe to news","surname":"Surname","zip":"Postal/ZIP Code"},"flash":{"fail":"An error occurred!","thanks":"Thanks for the order!"},"for_new_clients":"For new clients","for_order_summ":"for order total greater than","for_registered_clients":"For registered clients","go_back":"Back","go_forward":"Continue","go_pay":"Proceed to checkout","go_to_orders":"Go back to orders","go_to_registration":"Register new account","go_to_shop":"Go to the shop","information_is_sent_by_email":"Order information was sent to your e-mail","language":"Language","link_to_password_change":"Link for password change was sent on your e-mail","login_fail":"Login and password you entered did not match each other","login_through":"or login with","margin":"Payment service charge","max_bonus_points":"Maximum","name":"Items","next_level_discount":"Nearest discount is","no_delivery":"Shipping not requested","order":"Order","order_content":"Order summary","order_missing":"Specified e-mail not found","order_number":"Order №","order_payment":"Order payment","order_status":"Order status","ordering":"Checkout","orders":{"complete_orders_amount":"Completed orders","order_amount":"Order total","order_date":"Order date","order_number":"Order number","order_payment":"Payment","order_status":"Status"},"orders_history_title":"Order history","orders_title":"Orders and discounts","paid_status":{"false":"not paid","true":"paid"},"password":"Password","password_change_request_expired":"Your password change request was expired. Please, repeat your password regeneration request once again.","password_changing":"Password change","password_confirmation":"Repeat password","payment_choice":"Payment","payment_confirmation":"Payment confirmation","payment_status":"Payment status","payment_way":"Payment method","paypal_confirm_info":"You have set PayPal as your payment method. You need to approve the transaction for your order to be processed.","price_without_delivery":"price without shipping","print_receipt":"Proceed to checkout (print payment receipt)","products":{"one":"1 product","other":"%{count} products"},"quick_login_registration":"Quick login/registration","recipient":"Recipient","recipients_phone":"Recipient's phone","register":"Register","register_me_on_this_site":"Please create my account","registered_client_advantages":"You will be able to view your order history, take advantage of a faster shopping experience and get exclusive discounts","registration_title":"Register new account","reload_captcha":"Reload image","restore_password":"Password regeneration","save":"Save changes","send":"Send feedback","set_password":"To set new password","shop_title":"Continue shopping","sku":"SKU","step":"Step","summary":"Order summary","total":"Total","use_all_bonus_points":"Spend all","use_bonus_points":"Use bonus points to pay","user":"Username","using_service":"The Storefront is made via %{service_name} service","warnings":{"deliveries":"Shipping","deliveries_not_available":"There are no shipping options assigned to payment methods.","delivery_settings":"You can edit shipping options in section Settings","page_title":"Store settings are incorrect!","payment_settings":"You can edit payment options in section Settings","payments":"Payments"},"wrong_email":"Wrong e-mail","your_order":"Your order"}}},"es":{"number":{"currency":{"format":{"format":"%u %n"}},"format":{"delimiter":",","separator":0}},"shop":{"find":"Buscar","order_registration":{"account":"Mi cuenta","accumulated_discount_title":"Descuento acumulado","additional_info":"Información adicional","address_updated":"Dirección de envío guardada","addresses_title":"Dirección de envío","antibot_protection":"Prevención de las registraciones automáticas","bonus":{"reason":"Requisito"},"bonuses":"Bonos","captcha_label":"Escribe las letras que aparecen en el cuadro de arriba","change_password":"Cambiar contraseña","check_checkout_data":"Comprueba los datos proporcionados y confirma el pedido","client_discount_title":"Descuento personal","client_room_title":"Mi cuenta","comment":"Comentarios para el pedido","confirm":"Confirmar el pago","confirm_payment":"Confirmar el pago","confirmation":"Confirmación","contacts":"Contactos","contacts_title":"Datos de contacto","contacts_updated":"Datos de contacto guardados","cost":"Monto","count":"Cantidad","current_accumulated_discount":"Descuento acumulado corriente","date":"Fecha","delivery":"Envío","delivery_address":"Dirección de envío","delivery_choice":"Forma de envío","delivery_method":"Forma de envío","description":"Descripción","discount":"Descuento","edit":"redactar","empty_orders_message":"Todavía no ha realizado ningún pedido","enter":"Entrar","enter_client_room":"Entrada a Mi cuenta","enter_email":"Introduce tu correo electrónico","exit":"Salida","feedback_client_email_label":"correo electrónico de contacto","feedback_content_label":"Tu pregunta, comentario o sugerencia","feedback_description":"Recibirás la respuesta de nuestra tienda por correo electrónico o por teléfono indicado en tus datos personales.","feedback_form_title":"Formulario para enviar tu feedback a la tienda","feedback_sent":"El mensaje ha sido enviado correctamente.","feedback_title":"Feedback","field":{"address":"Dirección","city":"Ciudad / Pueblo","country":"País","email":"Correo electrónico","email_confirmation":"Confirmación \u003Cnobr\u003EE-mail\u003C/nobr\u003E","name":"Persona de contacto (nombre y apellidos)","phone":"Número de teléfono de contacto","state":"Región","subscribe":"Suscribirse a las noticias de la tienda","surname":"Apellidos","zip":"Código postal"},"flash":{"fail":"Se ha producido un error","thanks":"Gracias por tu pedido!"},"for_new_clients":"Para nuevos clientes","for_order_summ":"al alcanzar suma","for_registered_clients":"Para clientes habituales","go_back":"Volver","go_forward":"Continuar","go_pay":"Proceder con el pago","go_to_orders":"Volver a los pedidos","go_to_registration":"Registrarse","go_to_shop":"Pasar a la tienda","information_is_sent_by_email":"Te hemos enviado un mensaje con toda la información necesaria al correo electrónico proporcionado.","language":"Idioma","link_to_password_change":"El enlace para cambiar contraseña está enviado a tu correo electrónico","login_fail":"El nombre de usuario no coincide con la contraseña","margin":"Sobretasa por la forma de pago (incluida en el monto)","name":"Título","next_level_discount":"Próximo nivel","no_delivery":"No se necesita el envío","order":"Pedido","order_content":"Contenido del pedido","order_missing":"El pedido indicado no se ha encontrado.","order_number":"Número del pedido","order_payment":"Pago del pedido","order_status":"Estatuto del pedido","ordering":"Procesar el pedido","orders":{"complete_orders_amount":"Suma de pedidos finalizados","order_amount":"Monto del pedido","order_date":"Fecha de facturación","order_number":"Número del pedido","order_payment":"Pago","order_status":"Estatuto"},"orders_history_title":"Historia de pedidos","orders_title":"Pedidos y descuentos","paid_status":{"false":"no pagado","true":"pagado"},"password":"Contraseña","password_change_request_expired":"Tu solicitud para un cambio de contraseña se ha caducado. Vuelve a recuperar la contraseña.","password_changing":"Cambio de contraseña","password_confirmation":"Repetir contraseña","payment_choice":"Forma de pago","payment_confirmation":"Confirmación del pago","payment_status":"Estatuto del pago","payment_way":"Forma de pago","paypal_confirm_info":"Has configurado el pago vía PayPal. Se necesita confirmar el pago para que tu pedido sea procesado.","price_without_delivery":"sin coste del transporte","print_receipt":"Proceder con el pago (imprimir la factura)","products":{"one":"%{count} artículo","other":"%{count} artículos"},"quick_login_registration":"Entrada rápida / registración","recipient":"Destinatario (nombre y apellidos)","recipients_phone":"Número de teléfono del destinatario","register":"Registrar","register_me_on_this_site":"Inscribirse como cliente habitual","registered_client_advantages":"Podrás ver la historia de pedidos, hacer unos nuevos con más facilidad y obtener descuentos","registration_title":"Registración","reload_captcha":"Renovar la imagen","restore_password":"Recuperar contraseña","save":"Guardar los cambios","send":"Enviar","set_password":"Establecer contraseña","shop_title":"Volver a la tienda","sku":"Artículo","step":"Paso","summary":"Total","total":"Total","user":"Usuario","using_service":"Nuestra tienda online está organizada vía el servicio %{service_name}","wrong_email":"Correo electrónico no es válido","your_order":"Tu pedido"}}},"it":{"number":{"currency":{"format":{"delimiter":",","format":"%u %n","precision":2,"separator":".","unit":"$"}},"format":{"delimiter":",","precision":3,"separator":"."}},"shop":{"find":"Cerca","order_registration":{"account":"Area personale","accumulated_discount_title":"Sconto accumulato","additional_info":"Dettagli ulteriori","address_updated":"Indirizzo della spedizione e’ stato salvato","addresses_title":"Indirizzo della spedizione","antibot_protection":"Protezione da registrazioni automatiche","bonus":{"reason":"Riferimento"},"bonuses":"Bonus","captcha_label":"Digitare il testo mostrato nell'immagine sopra","change_password":"Modificare la password","check_checkout_data":"Verificare i dati inseriti e confermare  l’ordine","client_discount_title":"Sconto personale","client_room_title":"Area personale","comment":"Commenti","confirm":"Confermare ordine","confirm_payment":"Confermare il pagamento","confirmation":"Conferma","contacts":"Contatti","contacts_title":"Dati personali","contacts_updated":"I dati personali sono stati salvati","cost":"Prezzo","count":"Q.ta","current_accumulated_discount":"Attuale sconto accumulato","date":"Data","delivery":"Consegna","delivery_address":"Indirizzo di spedizione","delivery_choice":"Modalita di spedizione","delivery_method":"Modalita di spedizione","description":"Descrizione","discount":"Sconto","edit":"modificare","empty_orders_message":"Non e’ presente alcun ordine","enter":"Accedere","enter_client_room":"Accesso area personale","enter_email":"Specificare e-mail","exit":"Esci","feedback_client_email_label":"e-mail per contatto","feedback_content_label":"Sua domanda, opinione o proposta","feedback_description":"La risposta dell negozio sara inviata sull e-mail  o telefono specificati nell area personale","feedback_form_title":"Modulo per contattare negozio","feedback_sent":"Messagio e’ stato inviato con successo","feedback_title":"Contattaci","field":{"address":"Indirizzo","city":"Citta/frazione","country":"Paese/stato","email":"E-mail","email_confirmation":"Conferma \u003Cnobr\u003EE-mail\u003C/nobr\u003E","middlename":"Middlename","name":"Persona di contatto","phone":"Telefono","state":"Regione","subscribe":"Iscriviti alla newsletter di negozio","surname":"Cognome","zip":"CAP"},"flash":{"fail":"Si e’ verificato un errore","payment_needed":"L'ordine è formato. In pochi secondi sarete reindirizzati alla pagina di pagamento.","thanks":"Grazie per aquisto!"},"for_new_clients":"Per nuovi clienti","for_order_summ":"quando totale raggiunge","for_registered_clients":"Per VIP clienti","go_back":"Indietro","go_forward":"Avanti","go_pay":"Prosegui con pagamento","go_to_orders":"Indietro nell ordini","go_to_registration":"Registrati","go_to_shop":"Vai al negozio","information_is_sent_by_email":"Sull e-mail specificato e’ stata inviata la lettera con tutti informazioni necessari","language":"Lingua","link_to_password_change":"ink per modificare la password e’ stato inviato sull e-mail da Lei specificato","login_fail":"E-mail e/o password inseriti non sono validi","login_through":"oppure entrare attraverso","margin":"Incluso spese di modalita di pagamento","name":"Nome prodotto","next_level_discount":"Prossimo livello","no_delivery":"Consegna non e’ richiesta(Ritiro in zona)","order":"Ordine","order_content":"Riepilogo dell ordine","order_missing":"Ordine non e’ stato trovato","order_number":"Ordine №","order_payment":"Pagamento","order_status":"Stato ordine","ordering":"Effettuare ordine","orders":{"complete_orders_amount":"Totale ordini precedenti","order_amount":"Totale ordine","order_date":"Order date","order_number":"Numero ordine","order_payment":"Pagamento","order_status":"Stato ordine"},"orders_history_title":"Storico dei ordini","orders_title":"Ordini e sconti","paid_status":{"false":"non pagato","true":"pagato"},"password":"Password","password_change_request_expired":"La sua richiesta di modificare la password e’ scaduta, ripetere di nuovo","password_changing":"Modifica la password","password_confirmation":"Ripetere la password","payment_choice":"Modalita di pagamento","payment_confirmation":"Conferma pagamento","payment_status":"Modalita di pagamento","payment_way":"Modalita di pagamento","paypal_confirm_info":"Ha scelto PayPal come modalita di pagamento. E’ neccesario confermare pagamento per proseguire con elaborazione dell ordine","price_without_delivery":"Senza costi di spedizione","print_receipt":"Prosegui con pagamento  (stampare ricevuta)","products":{"one":"1 product","other":"%{count} products"},"quick_login_registration":"Accesso veloce","recipient":"Destinatario (Nome Cognome)","recipients_phone":"Telefono destinatario","register":"Registrare","register_me_on_this_site":"Diventare VIP cliente","registered_client_advantages":"Lei puo controlare storico dei ordini, fare aquisti piu facile e ottenere sconti piu convenienti","registration_title":"Registrazione","reload_captcha":"Aggiornare l’immagine","restore_password":"Recupera password","save":"Salvare le modifiche","send":"Invia","set_password":"Impostare  la password","shop_title":"Indietro al negozio","sku":"Codice prodotto","step":"Step","summary":"Totale","total":"Totale","user":"Utente","using_service":"Negozio on-line è organizzato con l'aiuto del %{service_name} service","wrong_email":"E-mail errato","your_order":"Suo ordine"}}},"de":{"number":{"currency":{"format":{"delimiter":",","format":"%u %n","precision":2,"separator":".","unit":"$"}},"format":{"delimiter":",","precision":3,"separator":"."}},"shop":{"find":"Suche","order_registration":{"account":"Ihr Konto","accumulated_discount_title":"Gesammelte Rabatt-Punkte","additional_info":"Zusatzinfo","address_updated":"Versandadresse gespeichert","addresses_title":"Lieferungsadresse/Versandadresse","already_client":"Haben Sie schon bei uns gekauft?","antibot_protection":"Automatischer Registrierungsschutz","bonus":{"reason":"Grund"},"bonuses":"Prämien","captcha_label":"Geben Sie den Text aus dem Bild oben","change_password":"Passwort ändern","check_checkout_data":"Bitte überprüfen und bestätigen Sie alle Details Ihrer Bestellung und gehen Sie zur Kasse","client_discount_title":"Persönliche Rabatt-Punkte","client_room_title":"Kundenkonto","comment":"Kommentare","confirm":"Jetzt bestellen","confirm_payment":"Zahlungsbestätigung","confirmation":"Bestätigung","contacts":"Kontaktdaten","contacts_title":"Kundendaten","contacts_updated":"Kontaktdaten gespeichert","cost":"Preis","count":"Menge","current_accumulated_discount":"Derzeit angesammelte Rabatte","customer_field":"Käufer","date":"Datum","delivery":"Lieferung","delivery_address":"Lieferungsadresse","delivery_choice":"Versand","delivery_method":"Lieferungsbedingungen","delivery_price":"Versand","description":"Beschreibung","discount":"Rabatt","edit":"Bearbeiten","empty_orders_message":"Zur Zeit haben Sie keine vollendete Bestellungen","enter":"Eingeben","enter_client_room":"Zugriff auf Ihr Konto","enter_email":"E-Mail eingeben","exit":"Ausgang","feedback_client_email_label":"E-Mail für Rückmeldungen","feedback_content_label":"Ihre Fragen, Bemerkungen und Wünsche","feedback_description":"Sie werden per angegebene E-Mail oder Telefonnummer kontaktiert.","feedback_form_title":"Rückmeldungsform","feedback_sent":"Nachricht wurde erfolgreich gesendet","feedback_title":"Rückmeldung","field":{"address":"Adresse","city":"Stadt","country":"Land","email":"E-Mail","email_confirmation":"Wiederholen \u003Cnobr\u003EE-Mail\u003C/nobr\u003E","full_locality_name":"Ort","middlename":"Zweiter Vorname","name":"Ansprechpartner","not_filled":"Das Feld ist leer","phone":"Telefonnummer","state":"Staat","subscribe":"News abonnieren","surname":"Nachname","zip":"Postleitzahl/ZIP Code"},"flash":{"fail":"Ein Fehler aufgetreten","thanks":"Vielen Dank für Ihre Bestellung!"},"for_new_clients":"Für neue Kunden","for_order_summ":"Für die Bestellung mehr als","for_registered_clients":"Für registrierte Kunden","go_back":"Zurück","go_forward":"Weiter","go_pay":"Zur Kasse gehen","go_to_orders":"Zurück zur Bestellungen","go_to_registration":"Neu registrieren","go_to_shop":"Besuchen","have_account":"Ich habe bereits einen Account","information_is_sent_by_email":"Bestellungsinfo wurde auf Ihr E-Mail gesendet","language":"Sprache","link_to_password_change":"Link zur Passwortänderung wurde auf Ihr E-Mail verschickt","login_fail":"Eingegebene Login und Passwort passen nicht zueinander","margin":"Zahlungsgebühr","name":"Artikelname","next_level_discount":"Nächste Rabatt ist","no_delivery":"Versand nicht beantragt","order":"Bestellen","order_content":"Bestellübersicht","order_info":"Bestellinformationen","order_missing":"Angegebene E-Mail ist nicht gefunden","order_number":"Bestellung №","order_payment":"Zahlung","order_status":"Bestellungsstand","ordering":"Zur Kasse","orders":{"complete_orders_amount":"vollendete Bestellungen","order_amount":"Total Bestellungen","order_date":"Bestellungsdatum","order_number":"Bestellungsnummer","order_payment":"Zahlung","order_status":"Bestellungsstand"},"orders_history_title":"Bestellungshistorie","orders_title":"Bestellungen und Rabatte","paid_status":{"false":"nicht bezahlt","true":"Bezahlt"},"password":"Passwort","password_change_request_expired":"Ihre Anfrage über die Passwortänderung wurde abgelaufen. Bitte wiederholen Sie Ihre Anfrage.","password_changing":"Passwort ändern","password_confirmation":"Passwort wiederholen","payment_choice":"Zahlung","payment_confirmation":"Zahlungsbestätigung","payment_status":"Zahlungsstand","payment_way":"Zahlungsart","paypal_confirm_info":"Sie haben PayPal als Zahlungsmethode gewählt.\nSie müssen die Transaktion bestätigen um weiterzufahren.","price_without_delivery":"Preis ohne Versandkosten","print_receipt":"Zur Kasse gehen (Beleg ausdrücken)","products":{"one":"1 Artikel","other":"%{count} Artikel"},"products_subtotal":"Zwischensumme","quick_login_registration":"Schnelle Login/Anmeldung","recipient":"Empfänger","recipient_field":"Empfänger","recipients_phone":"Telefon von Empfänger","register":"Register","register_me_on_this_site":"Bitte erstellen Sie Ihr Konto","registered_client_advantages":"Sie können Ihre Bestellungshistorie ansehen, von einem schnelleren Kauferlebnis profitieren und exklusive Rabatte erhalten","registration_title":"Neu registrieren","reload_captcha":"Bild neue laden","restore_password":"Passworterneuerung","save":"Änderungen speichern","send":"Rückmeldung senden","set_password":"Neue Passwort festlegen","shop_title":"Zurück zum Shop","sku":"Artikelnummer","step":"Schritt","sum_and_status":"Betrag und Status","summary":"Bestellung Total","total":"Total","user":"Benutzname","using_service":"Die Schaufenster wird über %{service_name} Service gemacht.","wrong_email":"Falsche E-Mail","your_order":"Ihre Bestellung"}}},"fr":{"number":{"currency":{"format":{"delimiter":",","format":"%u %n","precision":2,"separator":".","unit":"$"}},"format":{"delimiter":",","precision":3,"separator":"."}},"shop":{"find":"Find","order_registration":{"account":"Личный кабинет","accumulated_discount_title":"Накопленная скидка","additional_info":"Informations complémentaires","address_updated":"Адрес доставки сохранен","addresses_title":"Адрес доставки","antibot_protection":"Automatic registration protection","bonus":{"reason":"Reason"},"bonuses":"Bonuses","captcha_label":"Type the text from the image above","change_password":"Сменить пароль","check_checkout_data":"Проверьте введённые данные и подтвердите заказ","client_discount_title":"Personal discount points","client_room_title":"Кабинет покупателя","comment":"commentaire","confirm":"Je confirme la commande","confirm_payment":"Подтвердить оплату","confirmation":"Confirmation","contacts":"Contact","contacts_title":"Контактные данные","contacts_updated":"Контактные данные сохранены","cost":"Prix","count":"Quantité","current_accumulated_discount":"Текущая накопленная cкидка","date":"Date","delivery":"Livraison","delivery_address":"L'adresse pour la livraison","delivery_choice":"Choisirez le moyen de la livraison","delivery_method":"Le moyen de la livraison","description":"Description","discount":"Réduction","edit":"редактировать","empty_orders_message":"Вы не сделали ещё ни одного заказа","enter":"Войти","enter_client_room":"Вход в кабинет покупателя","enter_email":"Введите адрес электронной почты","exit":"Выход","feedback_client_email_label":"email для обратной связи","feedback_content_label":"Ваш вопрос, отзыв или пожелание","feedback_description":"Ответ магазина поступит на email или телефон, указанный в контактных данных.","feedback_form_title":"Форма обратной связи с магазином","feedback_sent":"Сообщение успешно отправлено.","feedback_title":"Обратная связь","field":{"address":"Address","city":"City","country":"Country","email":"E-mail","email_confirmation":"Répéter \u003Cnobr\u003EE-mail\u003C/nobr\u003E","middlename":"Patronyme","name":"Votre Nom, Prenom","phone":"Votre numéro de téléphone","state":"State","subscribe":"Subscribe to news","surname":"Nom","zip":"Postal/ZIP Code"},"flash":{"fail":"Erreur","thanks":"Merci pour votre commande!"},"for_new_clients":"Для новых покупателей","for_order_summ":"при достижении суммы","for_registered_clients":"Для постоянных покупателей","go_back":"Revenir","go_forward":"Continuer","go_pay":"Перейти к оплате","go_to_orders":"Вернуться к заказам","go_to_registration":"Зарегистрироваться","go_to_shop":"Перейти в магазин","information_is_sent_by_email":"Nous avons envoyer la lettre sur votre l'adresse e-mail","language":"Язык","link_to_password_change":"Ссылка на смену пароля отправлена на указанный адрес","login_fail":"Сочетание логина и пароля не подходит","margin":"Payment service charge","name":"Lot","next_level_discount":"Следующий уровень","no_delivery":"Доставка не требуется","order":"Commande","order_content":"Состав заказа","order_missing":"Указанный заказ не найден","order_number":"Commande №","order_payment":"Оплата заказа","order_status":"Le statut de la commande","ordering":"Faire la commande","orders":{"complete_orders_amount":"Сумма выполненных заказов","order_amount":"Сумма заказа","order_date":"Дата оформления","order_number":"Номер заказа","order_payment":"Оплата","order_status":"Статус"},"orders_history_title":"История заказов","orders_title":"Заказы и скидки","paid_status":{"false":"N'est pas payé","true":"Payer"},"password":"Mot de passe:","password_change_request_expired":"Ваш запрос на смену пароля устарел, восстановите пароль повторно","password_changing":"Изменение пароля","password_confirmation":"Répéter Votre mot de passe:","payment_choice":"Choisirez le moyen du paiement","payment_confirmation":"Подтверждение оплаты","payment_status":"Статус оплаты","payment_way":"Le moyen du paiement","paypal_confirm_info":"Вы настроили оплату через систему PayPal. Необходимо подтвердить оплату, чтобы заказ поступил в обработку.","price_without_delivery":"без учёта доставки","print_receipt":"Aller au paiement (imprimer le reçu)","products":{"few":"%{count} lots","one":"%{count} lot","other":"%{count} lots"},"quick_login_registration":"Быстрый вход/регистрация","recipient":"Получатель","recipients_phone":"Votre numéro de téléphone","register":"Зарегистрировать","register_me_on_this_site":"Enregistrer","registered_client_advantages":"Вы сможете видеть историю заказов, проще делать новые и получать скидки","registration_title":"Регистрация","reload_captcha":"Reload image","restore_password":"Восстановить пароль","save":"Сохранить изменения","send":"Отправить","set_password":"Установить пароль","shop_title":"Revenir au magasin","sku":"Артикул","step":"Шаг","summary":"Prix totale","total":"Total","user":"Пользователь","using_service":"Ce magasin est organisé par %{service_name}","wrong_email":"Неправильный email","your_order":"Ваш заказ"}}},"fi":{"number":{"currency":{"format":{"format":"%u %n"}},"format":{"delimiter":","}},"shop":{"find":"Hae","order_registration":{"account":"Oma profiili","accumulated_discount_title":"Säästetty alennuksesi","additional_info":"Lisätiedot","address_updated":"Vastaanottajan sähköpostiosoite on tallennettu","addresses_title":"Vastaanottajan osoite","antibot_protection":"Turva automaattisista rekisteröinneistä","bonus":{"reason":"Peruste"},"bonuses":"Bonukset","captcha_label":"Kirjoita teksti, joka näkyy kuvasta yläpuolelta","change_password":"Vaihda salasana","check_checkout_data":"Tarkista kirjoittamasi tiedot ja vahvista tilaus","client_discount_title":"Henkilökohtainen alennus","client_room_title":"Ostajan profiili","comment":"Lisää mainittavaa","confirm":"Vahvista tilaus","confirm_payment":"Vahvista maksu","confirmation":"Vahvistus","contacts":"Yhteystiedot","contacts_title":"Yhteystiedot","contacts_updated":"Yhteystiedot ovat tallennettu","cost":"Hinta","count":"Määrä","current_accumulated_discount":"Voimassa oleva säästetty alennuksesi","date":"Päivänmäärä","delivery":"Kuljetus","delivery_address":"Vastaanottajan osoite","delivery_choice":"Kuljetustapa","delivery_method":"Kuljetustapa","description":"Kuvaus","discount":"Alennus","edit":"Muokkaa","empty_orders_message":"Sinä et ole tehnyt vielä yhtään tilausta","enter":"Kirjaudu sisään","enter_client_room":"Kirjaudu ostajan profiiliin","enter_email":"Kirjoita sähköpostiosoite","exit":"Kirjaudu ulos","feedback_client_email_label":"Sähköpostiosoitteesi, johon tulee vastaus","feedback_content_label":"Kysymeksesi, palautteesi tai toivosi","feedback_description":"Vastaus kaupasta lähetetään yhteystiedoissasi mainittuun sähköpostiosoitteeseesi tai tekstiviestinä puhelimeesi.","feedback_form_title":"Palautteen muoto verkkokauppaan","feedback_sent":"Viestisi on lähetetty","feedback_title":"Palaute","field":{"address":"Osoite","city":"Kaupunki","country":"Maa","email":"Sähköposti","email_confirmation":"Vahvistus \u003Cnobr\u003EE-mail\u003C/nobr\u003E","middlename":"Kutsumanimi","name":"Yhteyshenkilö (nimi, sukunimi)","phone":"Puh.nro","state":"Alue","subscribe":"Tilaa verkkokaupan uutusia","surname":"Sukunimi","zip":"Postinumero"},"flash":{"fail":"Virhe","thanks":"Kiitos tilauksestasi!"},"for_new_clients":"Uusille ostajillemme","for_order_summ":"Summa saavutettua","for_registered_clients":"Kanta-asiakkaillemme","go_back":"Takaisin","go_forward":"Jatka","go_pay":"Siirry maksuun","go_to_orders":"Palaa tilauksiin","go_to_registration":"Rekisteröidy","go_to_shop":"Siirry kauppaan","information_is_sent_by_email":"Tarvittavat tiedot ovat lähetetty viestinä mainitsemaasi sähköpostiosoitteeseen","language":"Kieli","link_to_password_change":"Linkki salasanan vaihtamiseen on lähetetty mainittuun sähköpostiosoitteeseen","login_fail":"Käyttäjäntunnuksen ja salasanan yhdistelmä ei sovi","margin":"Hinnanlisäys maksutapaan (sisältyy hintaan)","name":"Nimike","next_level_discount":"Lähitaso","no_delivery":"Ei vaadi kuljetusta","order":"Tilaus","order_content":"Tilauksen sisältö","order_missing":"Mainitsemasi tilaus ei löydy","order_number":"Tilaus nro","order_payment":"Tilauksen maksu","order_status":"Tilauksen status","ordering":"Tilauksen laatiminen","orders":{"complete_orders_amount":"Tehtyjen tilauksien hinta","order_amount":"Tilauksen hinta","order_date":"Laatimisen päivänmäärä","order_number":"Tilauksen numero","order_payment":"Maksu","order_status":"Status"},"orders_history_title":"Tilauksien historia","orders_title":"Tilaukset ja alennukset","paid_status":{"false":"Ei maksattu","true":"maksattu"},"password":"Salasana","password_change_request_expired":"Pyyntösi salasanan vaihtoon on vanhentunut, uusi salasanasi uudelleen","password_changing":"Salasanan vaihto","password_confirmation":"Toista salasana","payment_choice":"Maksutapa","payment_confirmation":"Maksuvahvistus","payment_status":"Maksustatus","payment_way":"Maksutapa","paypal_confirm_info":"Olet asettanut PayPal maksujärjestelmän. Sinun pitää vahvistaa maksusi, että tilauksesi lähtisi käsittelyyn.","price_without_delivery":"Ilman kuljetusta","print_receipt":"Siirry maksuun (tulosta kuitti)","products":{"one":"%{count} tavara","other":"%{count} tavaroita"},"quick_login_registration":"Nopea rekisteröinti","recipient":"Vastaanottaja (nimi, sukunimi)","recipients_phone":"Vastaanottajan puh.nro","register":"Rekisteröi","register_me_on_this_site":"Tule kanta-asiakkaaksemme","registered_client_advantages":"Pääset näkemään tilauksiesi historian, laatimaan helpommin uusia tilauksia ja saamaan alennuksia.","registration_title":"Rekisteröinti","reload_captcha":"Päivitä kuva","restore_password":"Palauta salasana","save":"Talenna muutokset","send":"Lähetä","set_password":"Tallenna salasana","shop_title":"Palaa kauppaan","sku":"Artikkeli","step":"Vaihe","summary":"Yhteensä","total":"Yhteensä","user":"Käyttäjä","using_service":"Verkkokauppa on järjestetty %{service_name} palvelun kautta","wrong_email":"Väärä sähköpostiosoite","your_order":"Tilauksesi"}}},"ee":{"number":{"currency":{"format":{"delimiter":",","format":"%u %n","precision":2,"separator":".","unit":"$"}},"format":{"delimiter":",","precision":3,"separator":"."}},"shop":{"find":"Find","order_registration":{"account":"Isiklik ostja kabinet","accumulated_discount_title":"Kogutud allahindlus","additional_info":"Additional info","address_updated":"Saateaadresss on salvestatud","addresses_title":"Saateaadress","antibot_protection":"Защита от автоматических регистраций","bonus":{"reason":"Reason"},"bonuses":"Bonuses","captcha_label":"Наберите текст, изображённый на картинке выше","change_password":"Vaheta salasõna","check_checkout_data":"Palun kontrollige andmed ja kinnitage oma tellimus.","client_discount_title":"Personal discount points","client_room_title":"Isiklik Ostja kabinet","comment":"Kommentaarid","confirm":"Kinnitan tellimuse","confirm_payment":"Makse kinnitamine","confirmation":"Kinnitamine","contacts":"Kontaktandmed","contacts_title":"Kontakt andmed","contacts_updated":"Kontakt andmed on salvestatud","cost":"Maksumus","count":"Kogus","current_accumulated_discount":"Olemasolev kogutud allahindlus","date":"Date","delivery":"Tarnimine","delivery_address":"Tarneaadress","delivery_choice":"Tarneviisi valik","delivery_method":"Tarneviis","description":"Description","discount":"Soodustus","edit":"Muuda","empty_orders_message":"Teil ei ole ühtegi tellimust","enter":"Logi sisse","enter_client_room":"Ostja kabinet","enter_email":"Sisestage e-mail aadress","exit":"Välju","feedback_client_email_label":"Tagasiside e-mail","feedback_content_label":"Teie küsimus või ettepanek","feedback_description":"Võtame teiega ühenudst e-mail või telefoni teel.","feedback_form_title":"Tagasiside vorm","feedback_sent":"Kiri on edukalt saadetud.","feedback_title":"Tagasiside","field":{"address":"Aadress","city":"Linn","country":"Riik","email":"e-post","email_confirmation":"Kinnitus \u003Cnobr\u003EE-mail\u003C/nobr\u003E","middlename":"Isanimi","name":"Kontaktisik","phone":"Telefon","state":"Ala","subscribe":"Telli uudiskiri","surname":"Nimi","zip":"Postiindeks"},"flash":{"fail":"Tekkis viga","thanks":"Täname tellimuse eest!"},"for_new_clients":"Uuele kliendile","for_order_summ":"alates summast","for_registered_clients":"Püsiklientidele","go_back":"Tagasi","go_forward":"Jätka","go_pay":"Maksmine","go_to_orders":"Tagasi tellimuse juurde","go_to_registration":"Registreeri","go_to_shop":"Tagasi poodi","information_is_sent_by_email":"Teie poolt määratud e-postiaadressile saadeti teade koos vajamineva infoga.","language":"Keel","link_to_password_change":"Salasõna vahetamise link on saadetud sisestatud aadressile","login_fail":"Kasutaja nimi ja salasõna kombinatsioon ei sobi","margin":"Payment service charge","name":"Nimetus","next_level_discount":"Järgmine allahindluse tase","no_delivery":"Tulen ise järgi","order":"Tellimus","order_content":"Tellimuse sisu","order_missing":"Sisestatud tellimus ei leitud","order_number":"Tellimus nr.","order_payment":"Maksmine","order_status":"Tellimuse staatus","ordering":"Tellimuse vormistamine","orders":{"complete_orders_amount":"Täidetud tellimuste summa","order_amount":"Tellimuse summa","order_date":"Kuupäev","order_number":"Tellimuse number","order_payment":"Maksmine","order_status":"Staatus"},"orders_history_title":"Tellimuste ajalugu","orders_title":"Tellimused ja soodustused","paid_status":{"false":"maksmata","true":"makstud"},"password":"Parool","password_change_request_expired":"Teie salasõna vahetamise soov on aegunud, proovige uuesti,","password_changing":"Salasõna vahetamine","password_confirmation":"Paroolikordus","payment_choice":"Makseviisi valik","payment_confirmation":"Makse kinnitus","payment_status":"Makse staatus","payment_way":"Makseviis","paypal_confirm_info":"Olete valinud maksevahendiks PayPal. Tellimuse kinnitamiseks palun kinnitage oma makse.","price_without_delivery":"ilma transpordikuludeta","print_receipt":"Maksmine (prindi kviitung)","products":{"one":"%{count} kaup","other":"%{count} kaupa"},"quick_login_registration":"Kiire logi sisse/registreeri","recipient":"Saaja","recipients_phone":"Telefon","register":"Registreeri","register_me_on_this_site":"Registreerige mind","registered_client_advantages":"Saate näha oma tellimuste ajalugu ning on lihtsam teha uued tellimused ja saada allahindlusi","registration_title":"Registreerimine","reload_captcha":"Обновить изображение","restore_password":"Taasta salasõna","save":"Salvesta muudatused","send":"Saada","set_password":"Määra salasõna","shop_title":"Tagasi poodi","sku":"Artikli nr","step":"Samm","summary":"Kokku","total":"Total","user":"Kasutaja","using_service":"Interneti pood on organiseeritud %{service_name} süsteemi baasil","wrong_email":"Vale e-mail","your_order":"Teie tellimus"}}},"el":{"number":{"currency":{"format":{"delimiter":" ","format":"%u %n","precision":2,"separator":".","unit":"$"}},"format":{"precision":3,"separator":"."},"human":{"format":{"delimiter":"","precision":1},"storage_units":{"format":"%n %u","units":{"gb":"Gb","kb":"Kb","mb":"Mb","tb":"Tb"}}},"percentage":{"format":{"delimiter":""}},"precision":{"format":{"delimiter":""}},"quantity":"τεμ"},"shop":{"common_js":{"compare":"Συγκρίνετε","max_products":"Δεν μπορείτε να συγκρίνετε περισσότερα από 4 προϊόντα","product_added":"Το προϊόν προστέθηκε στο καλάθι","product_added_for_compare":"Το προϊόν προστέθηκε για να συγκρίνετε","product_already_added":"Αυτό το προϊόν έχει ήδη προστεθεί"},"find":"Βρείτε","order_registration":{"account":"Προσωπικός λογαριασμός","accumulated_discount_title":"Αθροιστικές εκπτώσεις","additional_info":"Επιπρόσθετες πληροφορίες","address_updated":"Η διεύθυνση παράδοσης είναι αποθηκευμένη","addresses_title":"Διεύθυνση παράδοσης","antibot_protection":"Προστασία από αυτόματες εγγραφές","bonus":{"reason":null},"bonuses":"Μπόνους","captcha_label":"Πληκτρολογήστε το κείμενο της πιο πάνω εικόνας","change_default_address":"Αλλαγή 'Προκαθορισμένης' διεύθυνσης","change_password":"Αλλαγή κωδικού πρόσβασης","check_checkout_data":"Ελέγξτε τα δεδομένα που έχουν εισαχθεί και να επιβεβαιώσετε την παραγγελία","client_bonus_points_question":"Πόσα θέλετε να ξοδέψετε;","client_discount_title":"Προσωπική έκπτωση","client_room_title":"ΠΡΟΣΩΠΙΚΟΣ ΛΟΓΑΡΙΑΣΜΟΣ","comment":"Σχόλια παραγγελίας","confirm":"ΕΠΙΒΕΒΑΙΩΣΗ ΠΑΡΑΓΓΕΛΙΑΣ","confirm_payment":"Επιβεβαιώσετε την πληρωμή","confirmation":"Επιβεβαίωση","contacts":"Επαφές","contacts_title":"Στοιχεία επικοινωνίας","contacts_updated":"Τα στοιχεία επικοινωνίας είναι αποθηκευμένα","cost":"Τιμή","count":"Ποσότητα","current_accumulated_discount":"Τρέχον αθροιστική εκπτώση","date":"Ημερομηνία","deliveries_not_available":"Δεν υπάρχει καμία μέθοδος παράδοσης!","delivery":"Παράδοση","delivery_address":"Διεύθυνση παράδοσης","delivery_choice":"Τρόπος παράδοσης","delivery_method":"Τρόπος παράδοσης","description":"Περιγραφή","discount":"Έκπτωση","edit":"επεξεργαστείτε","empty_orders_message":"Δεν έχετε καμία παραγγελία","enter":"ΕΙΣΟΔΟΣ","enter_client_room":"ΣΥΝΔΕΘΕΙΤΕ ΣΤΟ ΛΟΓΑΡΙΑΣΜΟ ΣΑΣ","enter_email":"Εισάγετε το e-mail σας","exit":"Έξοδος","feedback_client_email_label":"e-mail για επαφή","feedback_content_label":"Η ερώτηση σας, σχόλιο ή μήνυμα","feedback_default_subject":"Μήνυμα από επισκέπτη του ηλεκτρονικού καταστήματος","feedback_description":"Η απάντηση θα σας σταλεί στο e-mail σας ή τον αριθμό τηλεφώνου που αναφέρετε στις πληροφορίες της επαφής.","feedback_form_title":"ΕΠΙΚΟΙΝΩΝΗΣΤΕ ΜΑΖΙ ΜΑΣ","feedback_sent":"Το μήνυμα εστάλη με επιτυχία","feedback_title":"Επικοινωνήστε μαζί μου","field":{"address":"Διεύθυνση","city":"Πόλη / Περιοχή","country":"Χώρα","email":"E-mail","email_confirmation":"Επιβεβαίωση E-mail","middlename":null,"name":"Όνομα Επώνυμο","phone":"Τηλέφωνο επικοινωνίας","state":"Περιφέρεια","subscribe":"ΕΓΓΡΑΦΕΙΤΕ ΓΙΑ ΝΑ ΕΝΗΜΕΡΩΝΕΣΤΕ ΓΙΑ ΤΑ ΝΕΑ, ΠΡΟΣΦΟΡΕΣ ΚΑΙ ΕΚΠΤΩΣΕΙΣ","surname":"Επώνυμο","zip":"Ταχυδρομικός κωδικός"},"flash":{"fail":"Παρουσιάστηκε σφάλμα","payment_needed":"Η παραγγελία σας έχει εκδοθεί με επιτυχία. Μέσα σε λίγα δευτερόλεπτα θα μεταφερθείτε στη σελίδα πληρωμής.","thanks":"Σας ευχαριστούμε για την παραγγελία σας!"},"for_new_clients":"ΓΙΑ ΝΕΟΥΣ ΠΕΛΑΤΕΣ","for_order_summ":"φτάνοντας το ποσό","for_registered_clients":"ΓΙΑ ΕΓΓΕΓΡΑΜΜΕΝΟΥΣ ΠΕΛΑΤΕΣ","go_back":"Επιστροφή","go_forward":"Συνέχεια","go_pay":"Προχωρήστε στην πληρωμή","go_to_orders":"Επιστροφή στης παραγγελίες","go_to_registration":"εγγραφείτε","go_to_shop":"Μεταβείτε στο κατάστημα","information_is_sent_by_email":"Στο email σας έχει σταλεί μήνυμα με τις απαραίτητες πληροφορίες","language":"Γλώσσα","link_to_password_change":"Στο email σας έχει σταλεί σύνδεσμο για να αλλάξετε τον κωδικό πρόσβασης","login_fail":"Ο συνδυασμός του ονόματος του χρήστη και του κωδικού πρόσβασης δεν είναι σωστός","login_through":"ή συνδεθείτε με","margin":"Επιπλέον χρέωση για τον τρόπο πληρωμής (συμπεριλαμβάνεται στην τιμή)","max_bonus_points":"Μέγιστη","name":"Ονομασία","next_level_discount":"Επόμενο στάδιο","no_delivery":"Χωρίς παράδοση","order":"ΠΑΡΑΓΓΕΛΙΑ","order_content":"Η παραγγελία σας","order_missing":"Αυτή η παραγγελία δεν βρέθηκε","order_number":"ΠΑΡΑΓΓΕΛΙΑ №","order_payment":"Πληρωμή παραγγελίας","order_status":"ΚΑΤΑΣΤΑΣΗ ΠΑΡΑΓΓΕΛΙΑΣ","ordering":"CHECKOUT","orders":{"complete_orders_amount":"Το ποσό των ολοκληρωμένων παραγγελιών","order_amount":"Ποσό παραγγελίας","order_date":"Ημερομηνία καταχώρισης","order_number":"Αριθμός παραγγελίας","order_payment":"Πληρωμή","order_status":"ΚΑΤΑΣΤΑΣΗ"},"orders_history_title":"Ιστορικό παραγγελιών","orders_title":"Παραγγελίες και εκπτώσεις","paid_status":{"false":"δεν πληρώθηκε","true":"πληρώθηκε"},"password":"Κωδικός","password_change_request_expired":"Το αίτημά σας να αλλάξετε τον κωδικό πρόσβασης έχει λήξει, επαναφέρετε ξανά τον κωδικό πρόσβασης","password_changing":"Αλλαγή κωδικού πρόσβασης","password_confirmation":"Επανάληψη κωδικού πρόσβασης","payment_choice":"Τρόπος πληρωμής","payment_confirmation":"Επιβεβαίωση πληρωμής","payment_status":"Κατάσταση πληρωμής","payment_way":"Τρόπος πληρωμής","paypal_confirm_info":"Μπορείτε να ορίσετε την πληρωμή μέσω PayPal. Είναι απαραίτητο να επιβεβαιώσετε την πληρωμή για να προχωρήσει η παραγγελία σας.","price_without_delivery":"με εξαίρεση την παράδοση","print_receipt":"Μεταβείτε στην πληρωμή (να εκτυπώσετε την απόδειξη)","products":{"few":"%{count} προϊόν","many":"%{count} προϊόντα","one":"%{count} προϊόν","other":"%{count} προϊόντα"},"quick_login_registration":"ΓΡΗΓΟΡΗ ΣΥΝΔΕΣΗ / ΕΓΓΡΑΦΗ","recipient":"Παραλήπτης (όνομα)","recipients_phone":"Tηλέφωνο του παραλήπτη","register":"Εγγραφείτε","register_me_on_this_site":"Γίνετε τακτικός πελάτης","registered_client_advantages":"Για να μπορείτε να δείτε το ιστορικό των παραγγελιών σας, να κάνετε της παραγγελίες σας πιο εύκολες και να πάρετε εκπτώσεις","registration_title":"Εγγραφή","reload_captcha":"Επαναλάβετε τη φόρτωση της εικόνας","restore_password":"Ανάκτηση κωδικού","save":"ΑΠΟΘΗΚΕΥΣΗ ΑΛΛΑΓΩΝ","send":"ΑΠΟΣΤΟΛΗ","set_password":"Ρύθμιση κωδικού πρόσβασης","shop_title":"Συνεχίστε τις αγορές σας","sku":"Κωδικός προϊόντος","step":"Βήμα","summary":"Σύνολο","total":"Σύνολο","use_all_bonus_points":"Δαπανήστε τα όλα","use_bonus_points":"Χρησιμοποιήστε τα μπόνους κατά την πληρωμή","user":"Χρήστη","using_service":"Το ηλεκτρονικό κατάστημα είναι οργανωμένο με τη χρήση της υπηρεσίας %{service_name}","warnings":{"deliveries":"Παράδοση","deliveries_not_available":"Δεν υπάρχει μέθοδος παράδοσης που να συνδέεται με το κόστος  παράδοσης.","delivery_settings":"Για να ρυθμίσετε την παράδοση πρέπει να μεταβείτε στις Ρυθμίσεις","page_title":"Σφάλμα στις ρυθμίσεις του online κατάστημα!","payment_settings":"Για να ρυθμίσετε την πληρωμή πρέπει να μεταβείτε στις Ρυθμίσεις","payments":"Πληρωμή"},"wrong_email":"Λάθος e-mail","your_order":"Η παραγγελία σας"}}}};
});
(function() {
  define('shop/set_locale', ['jquery', 'i18n'], function($, i18n) {
    if ($('meta[name="default-locale"]').length) {
      i18n.locale = $('meta[name="default-locale"]').attr('content');
    }
    if (location.search.match(/[?&]lang=(\w+)(&|$)/)) {
      i18n.locale = RegExp['$1'];
    }
    return console.log('>>> set locale to', i18n.locale);
  });

}).call(this);
//
// extracted from common.js
//
define('shop/public/utils', ['jquery'], function($) {
  function compact(array) {
    var new_array = [];
    for (var i = 0; i < array.length; i++) {
      if ( array[i] ) new_array.push(array[i]);
    }
    return new_array;
  }

  function calculate_total_cost(product, variant, quantity) {
    if(product.using_price_types) {
      var price = variant.price;
      var price_type;
      for(var j in product.price_types) {
        if ( product.price_types[j].min_quantity > quantity )
          break;
        price_type = product.price_types[j];
      }
      if (price_type) {
        for(var i in variant.prices) {
          if ( variant.prices[i].price_type_id == price_type.id ) {
            price = variant.prices[i].price;
            break;
          }
        }
      }
      return price*quantity;
    } else {
      var price = variant.price;
      var price_kind;
      var price_kinds = product.price_kinds.sort(function(a,b){
        return a.value - b.value;
      });

      for(var j in price_kinds) {
        if ( price_kinds[j].value > quantity )
          break;
        if( variant.prices[product.price_kinds[j].price_index - 1] ){
          price_kind = product.price_kinds[j];
        }
      }
      if (price_kind) {
        price = variant.prices[price_kind.price_index - 1];
      }
      return price*quantity;
    }
  }

  function get_prices(product, variant) {
    if(product.using_price_types) {
      var price_by_type = {};
      for(var i in variant.prices) {
        var price = variant.prices[i];
        price_by_type[price.price_type_id] = price;
      }
      var previous = null;
      var table = []
      for(var j in product.price_types) {
        var price_type = product.price_types[j];
        var price = variant.price;
        var to = price_type.min_quantity - 1;
        var from = 1;
        if (previous) {
          price = price_by_type[previous.id].price;
          from = previous.min_quantity;
        }
        table.push({ from: from, to: to, price: price});
        previous = price_type;
      }
      if (previous) {
        table.push({ from: previous.min_quantity, to: null, price: price_by_type[previous.id].price});
        return table;
      } else {
        return false;
      }
    } else {
      var prices = variant.prices;
      var previous = null;
      var table = [];
      var price_kinds = product.price_kinds.sort(function(a,b){
        return a.value - b.value;
      });

      for(var j in price_kinds) {
        var price_kind = price_kinds[j];
        if(prices[price_kind.price_index - 1]){
          var price = variant.price;
          var to = price_kind.value - 1;
          var from = 1;
          if (previous) {
            price = prices[previous.price_index-1];
            from = previous.value;
          }
          table.push({ from: from, to: to, price: price});
          previous = price_kind;
        }
      }
      if (previous) {
        table.push({ from: previous.value, to: null, price: prices[previous.price_index - 1]});
        return table;
      } else {
        return false;
      }
    }
  }

  function floatToString(numeric, decimals) {
    numeric = parseFloat(numeric) || 0;
    var amount = numeric.toFixed(decimals).toString();
    if(amount.match(/^\.\d+/)) {return "0"+amount;}
    else {return amount;}
  };

  // Инициализировать добавление товара в корзину через Ajax.
  function initAjaxAddToCartButton(handle, onAddToCart) {
    if (!handle) {
      return;
    }

    $(document).on('click', handle, function(e){
      e.preventDefault();
      $(this).triggerCustom('clicked:insales:add_to_cart_button');
      addOrderItem( $(this).parents("form:first"), onAddToCart);
    });
  }

  // Добавление товара в корзину
  function addOrderItem(form, onAddToCart, dontShowPreloader) {
    var fields = form.serialize();
    var action = form.attr("action").split("?");
    var url    = action[0] + ".json";
    var lang   = action[1] ? "?"+action[1] : "";
    var path   = url + lang;

    if (!dontShowPreloader) {
      $(document).one('before_additem:insales:cart', function(e){
        if (!e.isDefaultPrevented()) {
          show_preloader();
        }
      });
      $(document).triggerCustom('before_additem:insales:cart');
    }

    $.ajax({
      url:      path,
      type:     'post',
      data:     fields,
      dataType: 'json',
      success:  function() {
        $(document).triggerCustom('add_item:insales:cart', { added: fields });
        $(document).triggerCustom('insales:cart:add_item', null, {deprecated: true});
        onAddToCart.apply(this, arguments);
      },
      error:    hide_preloader
    });
  }

  // функция вытаскивает сообщения об ошибке из хэша в массив.
  function errors_to_arr(errors){
    arr = [];
    $.each( errors, function(obj, msg){
      arr.push(msg);
    });
    return arr;
  }


  // Вывести индикатор работы (колесико)
  function show_preloader() {
    var preloader = $("#own_preloader");
    if ( !preloader.attr("id") ) {
      $("body").append('<div id="own_preloader"><img src="/served_assets/loading.gif"/></div>');
      preloader = $("#own_preloader");
    }

    preloader.show();

    changeCss(preloader);
    $(window).bind("resize", function(){
      changeCss(preloader);
    });
    $(window).bind("scroll", function(){
      changeCss(preloader);
    });
  }

  // Скрыть индикатор
  function hide_preloader() {
    var preloader = $("#own_preloader");
    if ( !preloader.attr("id") ) return;
    $(window).unbind("resize");
    $(window).unbind("scroll");
    preloader.remove();
  }

  // Заменить индикатор на сообщение
  function set_preloaders_message(message) {
    var preloader = $("#own_preloader");
    if ( !preloader.attr("id") ) return;
    preloader.html(message);
    changeCss(preloader);
  }

  function changeCss(OBJ){
    $(OBJ).css({width: 'auto', position: "absolute"});

    var imageHeight  = OBJ.height();
    var imageWidth   = OBJ.width();
    var windowWidth  = $(window).width();
    var windowHeight = $(window).height();

    OBJ.css({
      "left" : windowWidth / 2 - imageWidth / 2,
      "top" : getPageScroll()[1] + (getPageHeight() - imageHeight) / 2
    });
  };

  // getPageScroll() by quirksmode.com
  function getPageScroll() {
    var xScroll, yScroll;
    if (self.pageYOffset) {
      yScroll = self.pageYOffset;
      xScroll = self.pageXOffset;
    } else if (document.documentElement && document.documentElement.scrollTop) {   // Explorer 6 Strict
      yScroll = document.documentElement.scrollTop;
      xScroll = document.documentElement.scrollLeft;
    } else if (document.body) {// all other Explorers
      yScroll = document.body.scrollTop;
      xScroll = document.body.scrollLeft;
    }
    return new Array(xScroll,yScroll);
  }

  // Adapted from getPageSize() by quirksmode.com
  function getPageHeight() {
    var windowHeight;
    if (self.innerHeight) {  // all except Explorer
      windowHeight = self.innerHeight;
    } else if (document.documentElement && document.documentElement.clientHeight) { // Explorer 6 Strict Mode
      windowHeight = document.documentElement.clientHeight;
    } else if (document.body) { // other Explorers
      windowHeight = document.body.clientHeight;
    }
    return windowHeight
  }

  // Делаем мини-плагин для детектирования свой-чужой jQuery
  $.fn._checkLocalJQuery = function () {
    return this;
  }
  $(document)._checkLocalJQuery();

  function isBundleJQuery () {
    try {
      // Проверяем именно window, т.к. может прилететь 2ой, 3ий jQuery
      window.jQuery(document)._checkLocalJQuery()
      return true;
    }
    catch (error) {
      return false;
    }
  }

  return {
    compact: compact,
    calculate_total_cost: calculate_total_cost,
    get_prices: get_prices,
    floatToString: floatToString,
    initAjaxAddToCartButton: initAjaxAddToCartButton,
    addOrderItem: addOrderItem,
    errors_to_arr: errors_to_arr,
    show_preloader: show_preloader,
    hide_preloader: hide_preloader,
    set_preloaders_message: set_preloaders_message,
    changeCss: changeCss,
    getPageScroll: getPageScroll,
    getPageHeight: getPageHeight,
    isBundleJQuery: isBundleJQuery
  };
});
(function() {
  define('shop/public/insales/order_line', ['shop/public/insales'], function(InSales) {
    return InSales.OrderLine = (function() {
      function OrderLine(options) {
        var key, value;
        for (key in options) {
          value = options[key];
          this[key] = value;
        }
        if (options.title) {
          this.title = options.title.replace(/\+/g, ' ');
        }
        if (options.sku) {
          this.sku = options.sku.replace(/\+/g, ' ');
        }
        this.url = '/product/?product_id=' + options.product_id;
      }

      OrderLine.prototype.image = function(format) {
        if (this.image_url) {
          return this.image_url.replace('thumb', format);
        }
      };

      return OrderLine;

    })();
  });

}).call(this);
(function() {
  define('shop/public/insales/cart', ['jquery', 'i18n', 'shop/public/utils', 'shop/public/insales', 'shop/public/insales/order_line', 'jquery.trigger_custom'], function($, I18n, utils, InSales) {
    var cart, hide_preloader, initAjaxAddToCartButton, show_preloader;
    initAjaxAddToCartButton = utils.initAjaxAddToCartButton, show_preloader = utils.show_preloader, hide_preloader = utils.hide_preloader;
    cart = null;
    return InSales.Cart = (function() {
      Cart.loadCartData = function(callback) {
        var cart_json, e;
        if (($.cookie('cart') != null) && $.cookie('cart') !== 'json') {
          try {
            cart_json = $.parseJSON($.cookie('cart'));
          } catch (error) {
            e = error;
            cart_json = null;
          }
          return callback(cart_json);
        } else {
          return $.ajax({
            url: '/cart_items.json',
            dateType: 'json',
            success: callback
          });
        }
      };

      Cart.isEmpty = function(callback) {
        if (cart) {
          return callback(cart.items_count === 0);
        }
        return this.loadCartData(function(order) {
          var j, len, order_line, ref;
          ref = order.order_lines;
          for (j = 0, len = ref.length; j < len; j++) {
            order_line = ref[j];
            if (order_line.quantity > 0) {
              return callback(false);
            }
          }
          return callback(true);
        });
      };

      function Cart(options, format) {
        var drawCallback;
        if (options == null) {
          options = {};
        }
        if (cart != null) {
          return cart;
        }
        drawCallback = options.draw || function() {};
        if (!(this instanceof InSales.Cart)) {
          return new InSales.Cart(drawCallback, format);
        }
        cart = this;
        this.drawCallback = drawCallback;
        this.selector = options.selector;
        this.format = format;
        this.reloadCart((function(_this) {
          return function() {
            _this.draw();
            return initAjaxAddToCartButton(_this.selector, function(response) {
              return _this.addCallback();
            });
          };
        })(this));
        $(document).on('refresh:insales:cart', (function(_this) {
          return function() {
            return _this.refresh();
          };
        })(this));
      }

      Cart.prototype.get_text = function(text) {
        if (!text) {
          return text;
        }
        return text.replace(/\+/g, ' ');
      };

      Cart.prototype.setCart = function(order) {
        var items_count, order_line, order_lines;
        if (!order) {
          this.total_price = 0;
          this.items_price = 0;
          this.order_lines = [];
          this.items_count = 0;
          this.discounts = [];
          return;
        }
        this.total_price = order.total_price;
        this.items_price = order.items_price;
        items_count = 0;
        order_lines = (function() {
          var j, len, ref, results;
          ref = order.order_lines;
          results = [];
          for (j = 0, len = ref.length; j < len; j++) {
            order_line = ref[j];
            items_count += order_line.quantity;
            results.push(new InSales.OrderLine(order_line));
          }
          return results;
        })();
        this.order_lines = order_lines;
        this.items_count = items_count;
        this.discounts = order.discounts;
        return this.discount_code = order.discount_code;
      };

      Cart.prototype.reloadCart = function(callback) {
        return InSales.Cart.loadCartData((function(_this) {
          return function(order) {
            _this.setCart(order);
            $(document).triggerCustom('reloaded:insales:cart', _this);
            return callback();
          };
        })(this));
      };

      Cart.prototype.removeItemTrigger = function() {
        var self;
        self = this;
        return $('[id^="delete_"]').each(function(i) {
          var link, variant_id;
          if ($(this).attr('processed')) {
            return;
          }
          $(this).attr('processed', true);
          link = $(this);
          variant_id = link.attr('id').replace('delete_', '');
          return $(this).click(function(e) {
            e.preventDefault();
            return self.removeItem(variant_id);
          });
        });
      };

      Cart.prototype.removeItem = function(variant_id) {
        var fields, path;
        fields = new Object;
        fields['_method'] = 'delete';
        path = '/cart_items/' + variant_id + '.json';
        show_preloader();
        return $.ajax({
          url: path,
          type: 'post',
          data: fields,
          dataType: 'json',
          success: (function(_this) {
            return function(response) {
              return _this.reloadCart(function() {
                hide_preloader();
                _this.draw();
                return $(document).triggerCustom('remove_item:insales:cart', {
                  deleted: variant_id
                });
              });
            };
          })(this),
          error: function(response) {
            hide_preloader();
            return console.log('Cant remove item from cart');
          }
        });
      };

      Cart.prototype.addCallback = function() {
        return this.reloadCart((function(_this) {
          return function() {
            _this.draw();
            set_preloaders_message('<div id="add_product_notification">' + I18n.t('shop.common_js.product_added') + '</div>');
            return window.setTimeout(hide_preloader, 1000);
          };
        })(this));
      };

      Cart.prototype.draw = function() {
        this.drawCallback(this);
        return this.removeItemTrigger();
      };

      Cart.prototype.refresh = function() {
        return this.reloadCart((function(_this) {
          return function() {
            return _this.draw();
          };
        })(this));
      };

      return Cart;

    })();
  });

}).call(this);
(function() {
  define('shop/public/insales/compare', ['jquery', 'i18n', 'shop/public/utils', 'shop/public/insales'], function($, I18n, utils, InSales) {
    var hide_preloader, show_preloader;
    show_preloader = utils.show_preloader, hide_preloader = utils.hide_preloader;
    return InSales.Compare = (function() {
      function Compare(options) {
        this.textAdd = I18n.t('shop.common_js.product_added_for_compare');
        this.textLink = I18n.t('shop.common_js.compare');
        this.textRepeat = I18n.t('shop.common_js.product_already_added');
        this.textCompareEnd = I18n.t('shop.common_js.max_products');
        this.productsCounter = 0;
        this.ProductId = 0;
        this.ProductIdRepeat = false;
        this.drawCallback = options.draw;
        this.selector = options.selector;
        this._textAdd = options._textAdd;
        this._textLink = options._textLink;
        this._textRepeat = options._textRepeat;
        this._textCompareEnd = options._textCompareEnd;
        this.otherText();
        this.reload();
        this.draw();
        this.addItemTrigger();
      }

      Compare.prototype.otherText = function() {
        if (this._textAdd) {
          this.textAdd = this._textAdd;
        }
        if (this._textLink) {
          this.textLink = this._textLink;
        }
        if (this._textRepeat) {
          this.textRepeat = this._textRepeat;
        }
        if (this._textCompareEnd) {
          return this.textCompareEnd = this._textCompareEnd;
        }
      };

      Compare.prototype.get_text = function(text) {
        if (!text) {
          return text;
        }
        return text.replace(/\+/g, ' ');
      };

      Compare.prototype.reload = function() {
        var e, j, len, product, ref;
        try {
          this.products = $.parseJSON($.cookie('compare'));
        } catch (error) {
          e = error;
          this.products = null;
        }
        if (!this.products) {
          this.products = [];
        }
        this.productsCounter = this.products.length;
        ref = this.products;
        for (j = 0, len = ref.length; j < len; j++) {
          product = ref[j];
          $('a[rel=' + this.id + ']').not('.del_compare').text('' + this.textAdd + '').addClass('compare-added');
          product['title'] = this.get_text(product['title']);
        }
        return void 0;
      };

      Compare.prototype.removeItemTrigger = function() {
        var self;
        self = this;
        return $('.remove_compare').each(function(i) {
          var product_id;
          if ($(this).attr('processed')) {
            return;
          }
          $(this).attr('processed', true);
          product_id = $(this).attr('rel');
          return $(this).click(function(e) {
            e.preventDefault();
            return self.removeItem(product_id);
          });
        });
      };

      Compare.prototype.removeItem = function(product_id) {
        var fields, path;
        fields = new Object(null);
        fields['_method'] = 'delete';
        if (InSales.QueryString['lang']) {
          fields['lang'] = InSales.QueryString['lang'];
        }
        path = '/compares/' + product_id + '.json';
        show_preloader();
        return $.ajax({
          url: path,
          type: 'post',
          data: fields,
          dataType: 'json',
          success: (function(_this) {
            return function(response) {
              $('.compare_' + product_id).remove();
              $('a[rel=' + product_id + ']').text('' + _this.textLink + '').removeClass('compare-added');
              _this.reload();
              hide_preloader();
              return _this.draw();
            };
          })(this),
          error: function(response) {
            return hide_preloader();
          }
        });
      };

      Compare.prototype.addItemTrigger = function() {
        var self;
        self = this;
        return $(this.selector).on('click', function() {
          var data, path, product_id;
          self.productsCounter = self.productsCounter + 1;
          product_id = $(this).attr('rel');
          path = '/compares.json';
          self.ProductId = product_id;
          self.checkIsRepeated();
          show_preloader();
          if (self.productsCounter > 4) {
            set_preloaders_message('<div id="add_product_notification">' + self.textCompareEnd + '</div>');
            return window.setTimeout(hide_preloader, 3000);
          } else {
            $(this).text('' + self.textAdd + '').addClass('compare-added');
            data = {
              'product[id]': product_id
            };
            if (InSales.QueryString['lang']) {
              data['lang'] = InSales.QueryString['lang'];
            }
            return $.ajax({
              url: path,
              type: 'post',
              data: data,
              dataType: 'json',
              success: (function(_this) {
                return function(response) {
                  self.reload();
                  self.draw();
                  if (self.ProductIdRepeat === true) {
                    set_preloaders_message('<div id="add_product_notification">' + self.textRepeat + '</div>');
                    return window.setTimeout(hide_preloader, 3000);
                  } else {
                    set_preloaders_message('<div id="add_product_notification">' + self.textAdd + '</div>');
                    return window.setTimeout(hide_preloader, 3000);
                  }
                };
              })(this),
              error: function(response) {
                return hide_preloader();
              }
            });
          }
        });
      };

      Compare.prototype.draw = function() {
        this.drawCallback(this.products);
        return this.removeItemTrigger();
      };

      Compare.prototype.checkIsRepeated = function() {
        this.ProductIdRepeat = false;
        return $.each(this.products, (function(_this) {
          return function() {
            if (_this.ProductId === _this.id) {
              _this.ProductIdRepeat = true;
              return false;
            } else {
              return _this.ProductIdRepeat = false;
            }
          };
        })(this));
      };

      return Compare;

    })();
  });

}).call(this);
(function() {
  define('shop/public/insales/product', ['jquery', 'shop/public/utils', 'shop/public/insales'], function($, utils, InSales) {
    var compact;
    compact = utils.compact;
    return InSales.Product = (function() {
      function Product(json) {
        var id, option, property, ref, variant;
        for (property in json) {
          this[property] = json[property];
        }
        this.options_by_id = {};
        for (option in this.option_names) {
          this.addOption(this.option_names[option]);
        }
        for (variant in this.variants) {
          this.addVariant(this.variants[variant]);
        }
        ref = this.options_by_id;
        for (id in ref) {
          option = ref[id];
          option['values'] = compact(option['values']);
        }
      }

      Product.prototype.addOption = function(option) {
        return this.options_by_id[option['id']] = {
          title: option['title'],
          values: []
        };
      };

      Product.prototype.addVariant = function(variant) {
        var option_values, results, value;
        option_values = variant['option_values'];
        results = [];
        for (value in option_values) {
          results.push(this.addValue(option_values[value]));
        }
        return results;
      };

      Product.prototype.addValue = function(value) {
        var option;
        option = this.options_by_id[value['option_name_id']];
        return option['values'][value['position']] = value;
      };

      Product.prototype.optionNames = function() {
        return this.option_names;
      };

      Product.prototype.optionValues = function(index) {
        var option;
        option = this.option_names[index];
        if (!option) {
          return null;
        }
        return this.options_by_id[option['id']]['values'];
      };

      Product.prototype.getVariant = function(selectedValues) {
        var i, satisfied, variant;
        for (i in this.variants) {
          variant = this.variants[i];
          satisfied = true;
          $.each(variant['option_values'], function(index, value) {
            if (parseInt(selectedValues[value['option_name_id']]) !== value['id']) {
              satisfied = false;
            }
          });
          if (satisfied === true) {
            return variant;
          }
        }
        return null;
      };

      Product.prototype.variantById = function(id) {
        var i;
        for (i in this.variants) {
          if (parseInt(this.variants[i].id) === parseInt(id)) {
            return this.variants[i];
          }
        }
        return null;
      };

      return Product;

    })();
  });

}).call(this);
(function() {
  define('shop/public/insales/option_selectors', ['jquery', 'shop/public/insales', 'shop/public/insales/product'], function($, InSales) {
    return InSales.OptionSelectors = (function() {
      function OptionSelectors(existingSelectorId, options) {
        if (!$("#" + existingSelectorId).attr("id")) {
          return;
        }
        this.selectorDivClass = 'selector-wrapper';
        this.selectorClass = 'single-option-selector';
        this.variantIdFieldIdSuffix = '-variant-id';
        this.optionIdFieldIdPrefix = 'selector-option-id-';
        this.variantIdField = null;
        this.selectors = [];
        this.domIdPrefix = existingSelectorId;
        this.product = new InSales.Product(options['product']);
        this.onVariantSelected = options.onVariantSelected != null ? options.onVariantSelected : function() {};
        this.replaceSelector(existingSelectorId);
        this.selectAvailableVariant();
        this.selectVariantFromUrl();
        if (options['filterOptionValues']) {
          this.filterOptionValues();
        }
      }

      OptionSelectors.prototype.replaceSelector = function(domId) {
        var oldSelector, parent;
        oldSelector = document.getElementById(domId);
        parent = oldSelector.parentNode;
        $.each(this.buildSelectors(), function(index, el) {
          return parent.insertBefore(el, oldSelector);
        });
        oldSelector.style.display = 'none';
        return this.variantIdField = oldSelector;
      };

      OptionSelectors.prototype.buildSelectors = function() {
        var divClass, divId, elements, i, optionNames, sel;
        i = 0;
        while (i < this.product.optionNames().length) {
          sel = new InSales.SingleOptionSelector(this, i, this.product.optionNames()[i], this.product.optionValues(i));
          sel.element.disabled = false;
          this.selectors.push(sel);
          i++;
        }
        divClass = this.selectorDivClass;
        divId = this.optionIdFieldIdPrefix;
        optionNames = this.product.optionNames();
        elements = [];
        $.each(this.selectors, function(index, selector) {
          var div, label;
          div = document.createElement('div');
          div.setAttribute('class', divClass);
          div.setAttribute('id', divId + selector.option_id);
          if (optionNames.length > 1 || optionNames[0].title !== 'Модификация') {
            label = document.createElement('label');
            label.innerHTML = selector.name;
            div.appendChild(label);
          }
          div.appendChild(selector.element);
          return elements.push(div);
        });
        return elements;
      };

      OptionSelectors.prototype.selectedValues = function() {
        var currValues, i, selector, thisValue;
        currValues = {};
        i = 0;
        while (i < this.selectors.length) {
          selector = this.selectors[i];
          thisValue = selector.element.value;
          currValues[selector.option_id] = thisValue;
          i++;
        }
        return currValues;
      };

      OptionSelectors.prototype.getCurrVariant = function() {
        var currValues;
        currValues = this.selectedValues();
        return this.product.getVariant(currValues);
      };

      OptionSelectors.prototype.updateSelectors = function(index) {
        var variant;
        variant = this.getCurrVariant();
        if (variant) {
          this.variantIdField.disabled = false;
          this.variantIdField.value = variant.id;
        } else {
          this.variantIdField.disabled = true;
        }
        return this.onVariantSelected(variant, this);
      };

      OptionSelectors.prototype.selectAvailableVariant = function() {
        var i, values, variant;
        values = {};
        i = 0;
        while (i < this.product.variants.length) {
          variant = this.product.variants[i];
          if (!variant.available) {
            i++;
            continue;
          }
          $.each(variant.option_values, function(index, option_value) {
            return values[option_value.option_name_id] = option_value.id;
          });
          break;
          i++;
        }
        $.each(this.selectors, function(index, selector) {
          return selector.selectValue(values[selector.option_id]);
        });
        return this.selectors[0].element.onchange();
      };

      OptionSelectors.prototype.filterOptionValues = function() {
        var i, id_prefix, max_option_name_index, variant, variant_option_values, variants_option_values;
        variants_option_values = [];
        i = 0;
        while (i < this.product.variants.length) {
          variant = this.product.variants[i];
          variant_option_values = [];
          $.each(variant.option_values, function(index, option_value) {
            variant_option_values.push(option_value);
          });
          variants_option_values.push(variant_option_values);
          i++;
        }
        id_prefix = 'variant-select-option-';
        max_option_name_index = jQuery('.single-option-selector').size() - 1;
        $('.single-option-selector').on('change', function() {
          var id, next_option_name_index, next_option_values_select, next_selected_option_value_id, option_name_index, option_values, options, selected_option_value_id;
          selected_option_value_id = parseInt($(this).val());
          id = $(this).attr('id');
          option_name_index = parseInt(id.replace(id_prefix, ''));
          if (option_name_index === max_option_name_index) {
            return;
          }
          next_option_name_index = option_name_index + 1;
          option_values = [];
          $.each(variants_option_values, function(index, variant_option_values) {
            var allowed_option_value, current_option_value, next_option_value, prev_current_option_value_id;
            current_option_value = variant_option_values[option_name_index];
            if (current_option_value.id === selected_option_value_id) {
              allowed_option_value = true;
              i = option_name_index;
              while (i >= 0) {
                prev_current_option_value_id = parseInt($('#' + id_prefix + i).val());
                if (variant_option_values[i].id !== prev_current_option_value_id) {
                  allowed_option_value = false;
                }
                i--;
              }
              if (allowed_option_value) {
                next_option_value = variant_option_values[next_option_name_index];
                option_values = $.grep(option_values, function(option_value) {
                  return option_value.id !== next_option_value.id;
                });
                return option_values.push(next_option_value);
              }
            }
          });
          next_option_values_select = $('#' + id_prefix + next_option_name_index);
          next_selected_option_value_id = parseInt(next_option_values_select.val());
          options = '';
          $.each(option_values, function() {
            var selected;
            selected = '';
            if (this.id === next_selected_option_value_id) {
              selected = 'selected=\'selected\'';
            }
            return options += '<option value=\'' + this.id + '\' ' + selected + '>' + this.title + '</option>';
          });
          next_option_values_select.html(options);
          return next_option_values_select.trigger('change');
        });
        return $('#' + id_prefix + 0).trigger('change');
      };

      OptionSelectors.prototype.getUrlParameter = function(name) {
        return decodeURI((RegExp(name + '=' + '(.+?)(&|$)').exec(location.search) || [0, null])[1]);
      };

      OptionSelectors.prototype.selectVariantFromUrl = function() {
        var i, opt_id, variant, variant_id;
        variant_id = this.getUrlParameter('variant_id');
        if (variant_id == null) {
          return;
        }
        variant = this.product.variantById(variant_id);
        if (variant == null) {
          return;
        }
        for (i in variant.option_values) {
          opt_id = variant.option_values[i].id;
          $(this.variantIdField).parent().find('select option[value="' + opt_id + '"]').attr('selected', 'selected');
        }
        return this.updateSelectors();
      };

      return OptionSelectors;

    })();
  });

}).call(this);
(function() {
  define('shop/public/insales/single_option_selector', ['jquery', 'shop/public/insales'], function($, InSales) {
    return InSales.SingleOptionSelector = (function() {
      function SingleOptionSelector(multiSelector, index, option, values) {
        var i, len, opt, value;
        this.multiSelector = multiSelector;
        this.values = values;
        this.index = index;
        this.name = option['title'];
        this.option_id = option['id'];
        this.element = document.createElement('select');
        for (i = 0, len = values.length; i < len; i++) {
          value = values[i];
          opt = document.createElement('option');
          opt.value = value.id;
          opt.innerHTML = value.title;
          this.element.appendChild(opt);
        }
        this.element.setAttribute('class', this.multiSelector.selectorClass);
        this.element.id = multiSelector.domIdPrefix + '-option-' + index;
        this.element.onchange = function() {
          return multiSelector.updateSelectors(index);
        };
      }

      SingleOptionSelector.prototype.selectValue = function(value) {
        return $(this.element).find('option[value="' + value + '"]').each(function() {
          return $(this).attr("selected", "selected");
        });
      };

      return SingleOptionSelector;

    })();
  });

}).call(this);
(function() {
  define('shop/public/insales/ecommerce', ['jquery', 'shop/public/insales', 'shop/public/utils'], function($, InSales, utils) {
    var isBundleJQuery, yaEcommerce;
    isBundleJQuery = utils.isBundleJQuery;
    InSales.Ecommerce = (function() {
      function Ecommerce() {
        var config;
        config = InSales.getShopConfig();
        if (config.common_js_version) {
          return false;
        }
        this.template = {
          ecommerce: {
            currencyCode: config.currency_code
          }
        };
        this.bindLayer(config.ecommerce_data_container);
        this.bindAjaxEvents();
      }

      Ecommerce.prototype.send = function(data, method) {
        var _ecommerce;
        _ecommerce = this.template;
        _ecommerce.ecommerce[method] = {
          products: data
        };
        return this.layer.push(_ecommerce);
      };

      Ecommerce.prototype.add = function(items, order_lines) {
        return this.send(this.getAddedProducts(items, order_lines), 'add');
      };

      Ecommerce.prototype.getAddedProducts = function(items, order_lines) {
        var products;
        products = [];
        $.each(order_lines, (function(_this) {
          return function(index, line) {
            if (items[line.variant_id]) {
              return products.push(_this.addedProduct(line, items[line.variant_id]));
            }
          };
        })(this));
        return products;
      };

      Ecommerce.prototype.addedProduct = function(line, quantity) {
        var product;
        return product = {
          id: 'P#' + line.product_id,
          name: this.getProductTitle(line.title),
          quantity: quantity,
          price: line.sale_price,
          variant: this.getVariantTitle(line.title)
        };
      };

      Ecommerce.prototype.getProductTitle = function(title) {
        return title.toString().split('(')[0];
      };

      Ecommerce.prototype.getVariantTitle = function(title) {
        var result;
        result = title.match(/\(.*\)/);
        if (result) {
          result = result.toString();
          result = result.substring(1, result.length - 1);
        } else {
          result = '';
        }
        return result;
      };

      Ecommerce.prototype.remove = function(items) {
        var order_lines;
        if (!window.localStorage) {
          return false;
        }
        order_lines = JSON.parse(localStorage.getItem('bundle_cart'));
        return this.send(this.getDeletedProducts(parseInt(items), order_lines), 'remove');
      };

      Ecommerce.prototype.getDeletedProducts = function(items, order_lines) {
        var products;
        products = [];
        $.each(order_lines, (function(_this) {
          return function(index, line) {
            if (items === line.variant_id) {
              return products.push(_this.deletedProduct(line));
            }
          };
        })(this));
        return products;
      };

      Ecommerce.prototype.deletedProduct = function(line) {
        var product;
        return product = {
          id: 'P#' + line.product_id,
          name: this.getProductTitle(line.title)
        };
      };

      Ecommerce.prototype.bindAjaxEvents = function() {
        return $((function(_this) {
          return function() {
            window.jQuery(document).ajaxComplete(function(event, request, options) {
              if (options.url === '/cart_items.json' && options.type === 'POST') {
                _this.ajaxAdd(options.data);
              }
              if (options.data === '_method=delete') {
                return _this.ajaxRemove(options.url);
              }
            });
            if (!isBundleJQuery()) {
              $(document).on('add_item:insales:cart', function(event) {
                return _this.ajaxAdd(event.originalEvent.detail.added);
              });
              return $(document).on('remove_item:insales:cart', function(event) {
                return _this.ajaxRemove(event.originalEvent.detail.deleted);
              });
            }
          };
        })(this));
      };

      Ecommerce.prototype.bindLayer = function(layer) {
        return $((function(_this) {
          return function() {
            return _this.layer = window[layer];
          };
        })(this));
      };

      Ecommerce.prototype.ajaxAdd = function(data) {
        var items;
        items = InSales.getProductsFromOptions(data);
        return $.getJSON('/cart_items.json').done((function(_this) {
          return function(cart) {
            if (window.localStorage) {
              localStorage.setItem('bundle_cart', JSON.stringify(cart.order_lines));
            }
            return _this.add(items, cart.order_lines);
          };
        })(this));
      };

      Ecommerce.prototype.ajaxRemove = function(data) {
        var items;
        items = data.replace(/\D+/g, '');
        return this.remove(items);
      };

      return Ecommerce;

    })();
    return yaEcommerce = new InSales.Ecommerce();
  });

}).call(this);
(function() {
  define('shop/public/insales', ['jquery', 'i18n', 'shop/public/utils'], function($, i18n, utils) {
    var InSales;
    InSales = {
      money_format: function() {
        return "{{amount}} " + i18n.t('number.currency.format.unit');
      },
      numberWithDelimiter: function(number, delimiter) {
        var split;
        if (delimiter == null) {
          delimiter = ' ';
        }
        number += '';
        split = number.split('.');
        split[0] = split[0].replace(/(\d)(?=(\d\d\d)+(?!\d))/g, '$1' + delimiter);
        return split.join('.');
      },
      formatMoneyOld: function(amount, format) {
        var formatString, patt, value;
        patt = /\{\{\s*(\w+)\s*\}\}/;
        formatString = format || InSales.money_format();
        value = floatToString(amount, 2).replace(/,00/, '').replace(/\.00/, '');
        return formatString.replace(patt, value);
      },
      formatMoneyIsOld: function(params) {
        var err, moneyParams, oldFormat;
        oldFormat = false;
        try {
          moneyParams = $.parseJSON(params);
          if (moneyParams === null || typeof moneyParams !== 'object') {
            oldFormat = true;
          }
        } catch (error) {
          err = error;
          oldFormat = true;
        }
        return oldFormat;
      },
      formatMoney: function(amount, params) {
        var moneyParams, value;
        if (amount == null) {
          return '';
        }
        if ((params == null) && window.CURRENCY_FORMAT) {
          params = CURRENCY_FORMAT;
        }
        if ((params == null) && window.cv_currency_format) {
          params = cv_currency_format;
        }
        if (InSales.formatMoneyIsOld(params)) {
          return InSales.formatMoneyOld(amount, params);
        }
        amount = parseFloat(amount).toFixed(2) || 0;
        if (typeof amount === 'string') {
          amount = amount.replace(/\.00/, '');
        }
        moneyParams = $.parseJSON(params);
        value = moneyParams['show_price_without_cents'] ? Math.round(amount) : amount;
        value = InSales.numberWithDelimiter(value, moneyParams['delimiter']);
        value = value.replace(/\./, moneyParams['separator']);
        return moneyParams['format'].replace('%n', value).replace('%u', moneyParams['unit']);
      },
      isDefined: function(obj) {
        return obj != null;
      },
      getShopConfig: function() {
        return $('[name="shop-config"]').data('config');
      },
      getProductsFromOptions: function(data) {
        var _temp, items;
        items = {};
        _temp = {};
        $.each(data.split('&'), function(index, pair) {
          var key, ref, value;
          ref = pair.split('='), key = ref[0], value = ref[1];
          return _temp[key] = value;
        });
        if (_temp.variant_id) {
          items[_temp.variant_id] = _temp.quantity || 1;
        }
        $.each(_temp, function(key, item) {
          if (key.indexOf('variant_ids') !== -1) {
            return items[key] = item;
          }
        });
        return items;
      }
    };
    InSales.QueryString = (function() {
      var arr, i, pair, query, query_string, vars;
      query_string = {};
      query = window.location.search.substring(1);
      vars = query.split('&');
      i = 0;
      while (i < vars.length) {
        pair = vars[i].split('=');
        if (typeof query_string[pair[0]] === 'undefined') {
          query_string[pair[0]] = pair[1];
        } else if (typeof query_string[pair[0]] === 'string') {
          arr = [query_string[pair[0]], pair[1]];
          query_string[pair[0]] = arr;
        } else {
          query_string[pair[0]].push(pair[1]);
        }
        i++;
      }
      return query_string;
    })();
    InSales.init = function() {
      return $('#feedback_commit').click(function(e) {
        var fields, form;
        e.preventDefault();
        form = $('#feedback_form');
        fields = form.serialize();
        return $.ajax({
          url: form.attr('action') + '.json',
          type: 'post',
          data: fields,
          dataType: 'json',
          beforeSend: function() {
            show_preloader();
          },
          complete: function() {
            hide_preloader();
          },
          success: function(response) {
            var thanks;
            if (response.status === 'ok') {
              $('textarea[name=\'feedback[content]\']').val('');
              thanks = $('#thanks');
              thanks.html(response.notice);
              thanks.show();
              return window.setTimeout((function() {
                return thanks.fadeOut('slow', function() {
                  return thanks.hide();
                });
              }), 6000);
            } else {
              return alert(utils.errors_to_arr(response.errors).join('\n'));
            }
          }
        });
      });
    };
    return InSales;
  });

  require(['shop/public/insales/cart', 'shop/public/insales/compare', 'shop/public/insales/product', 'shop/public/insales/option_selectors', 'shop/public/insales/single_option_selector', 'shop/public/insales/ecommerce'], null, null, true);

}).call(this);
(function() {
  var module;

  module = function($) {
    var current;
    current = null;
    $.modal = (function() {
      function _Class(el, options) {
        var remove, target;
        $.modal.close();
        remove = void 0;
        target = void 0;
        this.$body = $('body');
        this.options = $.extend({}, $.modal.defaults, options);
        this.options.doFade = !isNaN(parseInt(this.options.fadeDuration, 10));
        if (el.is('a')) {
          target = el.attr('href');
          if (/^#/.test(target)) {
            this.$elm = $(target);
            if (this.$elm.length !== 1) {
              return null;
            }
            this.$body.append(this.$elm);
            this.open();
          } else {
            this.$elm = $('<div>');
            this.$body.append(this.$elm);
            remove = function(event, modal) {
              return modal.elm.remove();
            };
            el.trigger($.modal.AJAX_SEND);
            $.get(target).done(function(html) {
              if (!current) {
                return;
              }
              el.trigger($.modal.AJAX_SUCCESS);
              current.$elm.empty().append(html).on($.modal.CLOSE, remove);
              current.open();
              return el.trigger($.modal.AJAX_COMPLETE);
            }).fail(function() {
              el.trigger($.modal.AJAX_FAIL);
              return el.trigger($.modal.AJAX_COMPLETE);
            });
          }
        } else {
          this.$elm = el;
          this.$body.append(this.$elm);
          this.open();
        }
      }

      _Class.prototype.open = function() {
        var m;
        m = this;
        if (this.options.doFade) {
          this.block();
          setTimeout((function() {
            return m.show();
          }), this.options.fadeDuration * this.options.fadeDelay);
        } else {
          this.block();
          this.show();
        }
        if (this.options.escapeClose) {
          $(document).on('keydown.modal', function(event) {
            if (event.which === 27) {
              return $.modal.close();
            }
          });
        }
        if (this.options.clickClose) {
          return this.blocker.click(function(e) {
            if (e.target === this) {
              return $.modal.close();
            }
          });
        }
      };

      _Class.prototype.close = function() {
        this.unblock();
        this.hide();
        return $(document).off('keydown.modal');
      };

      _Class.prototype.block = function() {
        this.$elm.trigger($.modal.BEFORE_BLOCK, [this._ctx()]);
        this.blocker = $('<div class="m-overlay"></div>');
        this.$body.append(this.blocker);
        if (this.options.doFade) {
          this.blocker.css('opacity', 0).animate({
            opacity: 1
          }, this.options.fadeDuration);
        }
        return this.$elm.trigger($.modal.BLOCK, [this._ctx()]);
      };

      _Class.prototype.unblock = function() {
        var self;
        if (this.options.doFade) {
          self = this;
          return this.blocker.fadeOut(this.options.fadeDuration, function() {
            self.blocker.children().appendTo(self.$body);
            self.blocker.remove();
            return self.$body.css('overflow', '');
          });
        } else {
          this.blocker.children().appendTo(this.$body);
          this.blocker.remove();
          return this.$body.css('overflow', '');
        }
      };

      _Class.prototype.show = function() {
        this.$elm.trigger($.modal.BEFORE_OPEN, [this._ctx()]);
        this.$elm.data('modal', 'current');
        this.$elm.appendTo(this.blocker);
        if (this.options.doFade) {
          this.$elm.css('opacity', 0).show().animate({
            opacity: 1
          }, this.options.fadeDuration);
        } else {
          this.$elm.show();
        }
        return this.$elm.trigger($.modal.OPEN, [this._ctx()]);
      };

      _Class.prototype.hide = function() {
        var _this;
        this.$elm.trigger($.modal.BEFORE_CLOSE, [this._ctx()]);
        if (this.closeButton) {
          this.closeButton.remove();
        }
        this.$elm.removeData('modal');
        _this = this;
        if (this.options.doFade) {
          this.$elm.fadeOut(this.options.fadeDuration, function() {
            return _this.$elm.trigger($.modal.AFTER_CLOSE, [_this._ctx()]);
          });
        } else {
          this.$elm.hide(0, function() {
            return _this.$elm.trigger($.modal.AFTER_CLOSE, [_this._ctx()]);
          });
        }
        return this.$elm.trigger($.modal.CLOSE, [this._ctx()]);
      };

      _Class.prototype._ctx = function() {
        return {
          elm: this.$elm,
          blocker: this.blocker,
          options: this.options
        };
      };

      return _Class;

    })();
    $.modal.close = function(event) {
      var that;
      if (!current) {
        return;
      }
      if (event) {
        event.preventDefault();
      }
      current.close();
      that = current.$elm;
      current = null;
      return that;
    };
    $.modal.isActive = function() {
      if (current) {
        return true;
      } else {
        return false;
      }
    };
    $.modal.defaults = {
      escapeClose: true,
      clickClose: true,
      closeText: 'Close',
      closeClass: '',
      modalClass: 'modal',
      showClose: true,
      fadeDuration: null,
      fadeDelay: 1.0
    };
    $.modal.BEFORE_BLOCK = 'modal:before-block';
    $.modal.BLOCK = 'modal:block';
    $.modal.BEFORE_OPEN = 'modal:before-open';
    $.modal.OPEN = 'modal:open';
    $.modal.BEFORE_CLOSE = 'modal:before-close';
    $.modal.CLOSE = 'modal:close';
    $.modal.AFTER_CLOSE = 'modal:after-close';
    $.modal.AJAX_SEND = 'modal:ajax:send';
    $.modal.AJAX_SUCCESS = 'modal:ajax:success';
    $.modal.AJAX_FAIL = 'modal:ajax:fail';
    $.modal.AJAX_COMPLETE = 'modal:ajax:complete';
    $.fn.modal = function(options) {
      if (this.length === 1) {
        current = new $.modal(this, options);
      }
      return this;
    };
    $(document).on('click.modal', '[data-modal=close]', $.modal.close);
    return $(document).on('click.modal', '[data-modal=open]', function(event) {
      event.preventDefault();
      return $(this).modal();
    });
  };

  if (typeof define === 'function' && define.amd) {
    define('public/jquery.modal', ['jquery'], module);
  } else {
    module(window.jQuery);
  }

}).call(this);
(function() {
  define('shop/quick_checkout', ['jquery', 'i18n', 'shop/public/insales', 'shop/public/utils', 'public/jquery.modal'], function($, i18n, InSales, arg) {
    var addOrderItem, addToCart, cartIsEmpty, debounce, init, msg, onAfterAdd, reloadCart, setErrors, showDialog, submit, visitShow, visitSuccessful;
    addOrderItem = arg.addOrderItem;
    debounce = function(fn, timeout) {
      var locked;
      if (timeout == null) {
        timeout = 500;
      }
      locked = false;
      return function(e) {
        e.preventDefault();
        if (locked) {
          return;
        }
        locked = true;
        setTimeout((function() {
          return locked = false;
        }), timeout);
        return fn.apply(this, arguments);
      };
    };
    cartIsEmpty = function(callback) {
      if (window.Cart) {
        return callback(window.Cart.items_count === 0);
      }
      return InSales.Cart.isEmpty(callback);
    };
    showDialog = function() {
      return reloadCart(function() {
        return cartIsEmpty(function(empty) {
          var params;
          if (!empty) {
            setErrors([]);
            $('#insales-quick-checkout-dialog').modal({
              fadeDuration: 250
            });
            if (typeof grecaptcha !== "undefined" && grecaptcha !== null) {
              if (window.quick_checkout_recaptcha_id) {
                return grecaptcha.reset(window.quick_checkout_recaptcha_id);
              } else {
                params = {
                  'sitekey': $('#quick-checkout-recaptcha').data('sitekey'),
                  callback: "onReCaptchaSuccess"
                };
                return window.quick_checkout_recaptcha_id = grecaptcha.render('quick-checkout-recaptcha', params);
              }
            }
          }
        });
      });
    };
    visitSuccessful = function(order_id) {
      var iframe;
      iframe = $("<iframe src='/orders/successful?id=" + order_id + "' width='0' height='0'></iframe>");
      $('body').append(iframe);
      return iframe.on('load', function() {
        return $(iframe).remove();
      });
    };
    visitShow = function(url) {
      return window.location.replace(url);
    };
    submit = function(e) {
      var ajaxParams, form, onSuccess;
      e.preventDefault();
      form = e.target;
      onSuccess = function(result) {
        var order_id;
        if (result.result === 'ok') {
          order_id = result.location.substring(result.location.lastIndexOf('/') + 1);
          $.modal.close();
          setTimeout((function() {
            return msg(result.message);
          }), 0);
          reloadCart();
          if (result.show_thank_you_page) {
            return visitShow(result.location);
          } else {
            return visitSuccessful(order_id);
          }
        } else {
          return setErrors(result.errors);
        }
      };
      ajaxParams = {
        type: 'POST',
        dataType: 'json',
        success: onSuccess
      };
      if ($(form).find(':file').length && window.FormData) {
        ajaxParams.data = new FormData($(form).get(0));
        ajaxParams.processData = false;
        ajaxParams.contentType = false;
        ajaxParams.data.set('lang', i18n.locale);
      } else {
        ajaxParams.data = $(form).serializeArray();
        ajaxParams.data.push({
          name: 'lang',
          value: i18n.locale
        });
      }
      return $.ajax(form.action, ajaxParams);
    };
    setErrors = function(errors) {
      var e, errorsDiv, i, len, results;
      errorsDiv = $('#insales-quick-checkout-dialog .m-modal-errors');
      errorsDiv.empty();
      results = [];
      for (i = 0, len = errors.length; i < len; i++) {
        e = errors[i];
        results.push(errorsDiv.append($("<div class='m-modal-error error'>" + e + "</div>")));
      }
      return results;
    };
    msg = function(msg) {
      var div;
      div = $('#insales-quick-checkout-msg');
      if (!div.length) {
        div = $("<div id='insales-quick-checkout-msg' class='m-modal m-modal--msg'>\n  <div class='m-modal-wrapper'>\n    <button class='m-modal-close' data-modal='close'></button>\n    <div class='m-modal-msg'></div>\n  </div>\n</div>");
        div.appendTo($('body'));
      }
      $('.m-modal-msg', div).html(msg);
      return $(div).modal({
        fadeDuration: 250
      });
    };
    reloadCart = function(callback) {
      if ((window.Cart != null) && typeof Cart.reloadCart === 'function') {
        return Cart.reloadCart(callback);
      } else {
        $(document).one('reloaded:insales:cart', callback);
        return $(document).trigger('refresh:insales:cart');
      }
    };
    addToCart = function(form) {
      form = $(form);
      if (window.Cart) {
        onAfterAdd.once(showDialog);
        return Cart.addItem(form);
      } else {
        return addOrderItem(form, function() {
          hide_preloader();
          InSales.Cart().refresh();
          return showDialog();
        });
      }
    };
    onAfterAdd = function(fn) {
      if (typeof Events !== "undefined" && Events !== null) {
        return Events('onCart_AfterAdd').subscribe(fn);
      } else {
        return $(document).on('add_item:insales:cart', fn);
      }
    };
    onAfterAdd.once = function(fn) {
      var onceFn;
      onceFn = function() {
        if (typeof Events !== "undefined" && Events !== null) {
          Events('onCart_AfterAdd').unsubscribe(onceFn);
        } else {
          $(document).off('add_item:insales:cart', onceFn);
        }
        return fn.apply(this, arguments);
      };
      return onAfterAdd(onceFn);
    };
    init = function() {
      var dialog;
      dialog = $('#insales-quick-checkout-dialog');
      if (!dialog.length) {
        return;
      }
      console.log('Quick checkout enabled');
      if (dialog.data('autoActivate') != null) {
        onAfterAdd(showDialog);
      }
      $(dialog).on('submit', debounce(submit));
      $(document).on('click', '[data-quick-checkout]', function(e) {
        var button, quickCheckout;
        button = e.currentTarget || e.target;
        quickCheckout = $(button).data('quickCheckout');
        if (quickCheckout.length && $(quickCheckout).length && $(quickCheckout).is('form')) {
          e.preventDefault();
          return addToCart(quickCheckout);
        } else if (button.type === 'submit') {
          return onAfterAdd.once(showDialog);
        } else if ($(button).parents('form').length) {
          return addToCart($(button).parents('form').first());
        } else {
          e.preventDefault();
          return showDialog();
        }
      });
      if (typeof Events !== "undefined" && Events !== null) {
        Events('onQuickCheckout').subscribe(showDialog);
      }
      $(document).on('insales:quick_checkout', showDialog);
      return $(document).on('quick_checkout:insales', showDialog);
    };
    return $(init);
  });

}).call(this);
/*!
 * jQuery Form Plugin
 * version: 3.32.0-2013.04.09
 * @requires jQuery v1.5 or later
 * Copyright (c) 2013 M. Alsup
 * Examples and documentation at: http://malsup.com/jquery/form/
 * Project repository: https://github.com/malsup/form
 * Dual licensed under the MIT and GPL licenses.
 * https://github.com/malsup/form#copyright-and-license
 */
/*global ActiveXObject */


(function(module) {
if (typeof(define) == 'function' && define.amd) {
  define('jquery.form', ['jquery'], module);
} else {
  module(window.jQuery);
}})(function($) {
"use strict";

/*
    Usage Note:
    -----------
    Do not use both ajaxSubmit and ajaxForm on the same form.  These
    functions are mutually exclusive.  Use ajaxSubmit if you want
    to bind your own submit handler to the form.  For example,

    $(document).ready(function() {
        $('#myForm').on('submit', function(e) {
            e.preventDefault(); // <-- important
            $(this).ajaxSubmit({
                target: '#output'
            });
        });
    });

    Use ajaxForm when you want the plugin to manage all the event binding
    for you.  For example,

    $(document).ready(function() {
        $('#myForm').ajaxForm({
            target: '#output'
        });
    });

    You can also use ajaxForm with delegation (requires jQuery v1.7+), so the
    form does not have to exist when you invoke ajaxForm:

    $('#myForm').ajaxForm({
        delegation: true,
        target: '#output'
    });

    When using ajaxForm, the ajaxSubmit function will be invoked for you
    at the appropriate time.
*/

/**
 * Feature detection
 */
var feature = {};
feature.fileapi = $("<input type='file'/>").get(0).files !== undefined;
feature.formdata = window.FormData !== undefined;

var hasProp = !!$.fn.prop;

// attr2 uses prop when it can but checks the return type for
// an expected string.  this accounts for the case where a form
// contains inputs with names like "action" or "method"; in those
// cases "prop" returns the element
$.fn.attr2 = function() {
    if ( ! hasProp )
        return this.attr.apply(this, arguments);
    var val = this.prop.apply(this, arguments);
    if ( ( val && val.jquery ) || typeof val === 'string' )
        return val;
    return this.attr.apply(this, arguments);
};

/**
 * ajaxSubmit() provides a mechanism for immediately submitting
 * an HTML form using AJAX.
 */
$.fn.ajaxSubmit = function(options) {
    /*jshint scripturl:true */

    // fast fail if nothing selected (http://dev.jquery.com/ticket/2752)
    if (!this.length) {
        log('ajaxSubmit: skipping submit process - no element selected');
        return this;
    }

    var method, action, url, $form = this;

    if (typeof options == 'function') {
        options = { success: options };
    }

    method = this.attr2('method');
    action = this.attr2('action');

    url = (typeof action === 'string') ? $.trim(action) : '';
    url = url || window.location.href || '';
    if (url) {
        // clean url (don't include hash vaue)
        url = (url.match(/^([^#]+)/)||[])[1];
    }

    options = $.extend(true, {
        url:  url,
        success: $.ajaxSettings.success,
        type: method || 'GET',
        iframeSrc: /^https/i.test(window.location.href || '') ? 'javascript:false' : 'about:blank'
    }, options);

    // hook for manipulating the form data before it is extracted;
    // convenient for use with rich editors like tinyMCE or FCKEditor
    var veto = {};
    this.trigger('form-pre-serialize', [this, options, veto]);
    if (veto.veto) {
        log('ajaxSubmit: submit vetoed via form-pre-serialize trigger');
        return this;
    }

    // provide opportunity to alter form data before it is serialized
    if (options.beforeSerialize && options.beforeSerialize(this, options) === false) {
        log('ajaxSubmit: submit aborted via beforeSerialize callback');
        return this;
    }

    var traditional = options.traditional;
    if ( traditional === undefined ) {
        traditional = $.ajaxSettings.traditional;
    }

    var elements = [];
    var qx, a = this.formToArray(options.semantic, elements);
    if (options.data) {
        options.extraData = options.data;
        qx = $.param(options.data, traditional);
    }

    // give pre-submit callback an opportunity to abort the submit
    if (options.beforeSubmit && options.beforeSubmit(a, this, options) === false) {
        log('ajaxSubmit: submit aborted via beforeSubmit callback');
        return this;
    }

    // fire vetoable 'validate' event
    this.trigger('form-submit-validate', [a, this, options, veto]);
    if (veto.veto) {
        log('ajaxSubmit: submit vetoed via form-submit-validate trigger');
        return this;
    }

    var q = $.param(a, traditional);
    if (qx) {
        q = ( q ? (q + '&' + qx) : qx );
    }
    if (options.type.toUpperCase() == 'GET') {
        options.url += (options.url.indexOf('?') >= 0 ? '&' : '?') + q;
        options.data = null;  // data is null for 'get'
    }
    else {
        options.data = q; // data is the query string for 'post'
    }

    var callbacks = [];
    if (options.resetForm) {
        callbacks.push(function() { $form.resetForm(); });
    }
    if (options.clearForm) {
        callbacks.push(function() { $form.clearForm(options.includeHidden); });
    }

    // perform a load on the target only if dataType is not provided
    if (!options.dataType && options.target) {
        var oldSuccess = options.success || function(){};
        callbacks.push(function(data) {
            var fn = options.replaceTarget ? 'replaceWith' : 'html';
            $(options.target)[fn](data).each(oldSuccess, arguments);
        });
    }
    else if (options.success) {
        callbacks.push(options.success);
    }

    options.success = function(data, status, xhr) { // jQuery 1.4+ passes xhr as 3rd arg
        var context = options.context || this ;    // jQuery 1.4+ supports scope context
        for (var i=0, max=callbacks.length; i < max; i++) {
            callbacks[i].apply(context, [data, status, xhr || $form, $form]);
        }
    };

    // are there files to upload?

    // [value] (issue #113), also see comment:
    // https://github.com/malsup/form/commit/588306aedba1de01388032d5f42a60159eea9228#commitcomment-2180219
    var fileInputs = $('input[type=file]:enabled[value!=""]', this);

    var hasFileInputs = fileInputs.length > 0;
    var mp = 'multipart/form-data';
    var multipart = ($form.attr('enctype') == mp || $form.attr('encoding') == mp);

    var fileAPI = feature.fileapi && feature.formdata;
    log("fileAPI :" + fileAPI);
    var shouldUseFrame = (hasFileInputs || multipart) && !fileAPI;

    var jqxhr;

    // options.iframe allows user to force iframe mode
    // 06-NOV-09: now defaulting to iframe mode if file input is detected
    if (options.iframe !== false && (options.iframe || shouldUseFrame)) {
        // hack to fix Safari hang (thanks to Tim Molendijk for this)
        // see:  http://groups.google.com/group/jquery-dev/browse_thread/thread/36395b7ab510dd5d
        if (options.closeKeepAlive) {
            $.get(options.closeKeepAlive, function() {
                jqxhr = fileUploadIframe(a);
            });
        }
        else {
            jqxhr = fileUploadIframe(a);
        }
    }
    else if ((hasFileInputs || multipart) && fileAPI) {
        jqxhr = fileUploadXhr(a);
    }
    else {
        jqxhr = $.ajax(options);
    }

    $form.removeData('jqxhr').data('jqxhr', jqxhr);

    // clear element array
    for (var k=0; k < elements.length; k++)
        elements[k] = null;

    // fire 'notify' event
    this.trigger('form-submit-notify', [this, options]);
    return this;

    // utility fn for deep serialization
    function deepSerialize(extraData){
        var serialized = $.param(extraData).split('&');
        var len = serialized.length;
        var result = [];
        var i, part;
        for (i=0; i < len; i++) {
            // #252; undo param space replacement
            serialized[i] = serialized[i].replace(/\+/g,' ');
            part = serialized[i].split('=');
            // #278; use array instead of object storage, favoring array serializations
            result.push([decodeURIComponent(part[0]), decodeURIComponent(part[1])]);
        }
        return result;
    }

     // XMLHttpRequest Level 2 file uploads (big hat tip to francois2metz)
    function fileUploadXhr(a) {
        var formdata = new FormData();

        for (var i=0; i < a.length; i++) {
            formdata.append(a[i].name, a[i].value);
        }

        if (options.extraData) {
            var serializedData = deepSerialize(options.extraData);
            for (i=0; i < serializedData.length; i++)
                if (serializedData[i])
                    formdata.append(serializedData[i][0], serializedData[i][1]);
        }

        options.data = null;

        var s = $.extend(true, {}, $.ajaxSettings, options, {
            contentType: false,
            processData: false,
            cache: false,
            type: method || 'POST'
        });

        if (options.uploadProgress) {
            // workaround because jqXHR does not expose upload property
            s.xhr = function() {
                var xhr = jQuery.ajaxSettings.xhr();
                if (xhr.upload) {
                    xhr.upload.addEventListener('progress', function(event) {
                        var percent = 0;
                        var position = event.loaded || event.position; /*event.position is deprecated*/
                        var total = event.total;
                        if (event.lengthComputable) {
                            percent = Math.ceil(position / total * 100);
                        }
                        options.uploadProgress(event, position, total, percent);
                    }, false);
                }
                return xhr;
            };
        }

        s.data = null;
            var beforeSend = s.beforeSend;
            s.beforeSend = function(xhr, o) {
                o.data = formdata;
                if(beforeSend)
                    beforeSend.call(this, xhr, o);
        };
        return $.ajax(s);
    }

    // private function for handling file uploads (hat tip to YAHOO!)
    function fileUploadIframe(a) {
        var form = $form[0], el, i, s, g, id, $io, io, xhr, sub, n, timedOut, timeoutHandle;
        var deferred = $.Deferred();

        if (a) {
            // ensure that every serialized input is still enabled
            for (i=0; i < elements.length; i++) {
                el = $(elements[i]);
                if ( hasProp )
                    el.prop('disabled', false);
                else
                    el.removeAttr('disabled');
            }
        }

        s = $.extend(true, {}, $.ajaxSettings, options);
        s.context = s.context || s;
        id = 'jqFormIO' + (new Date().getTime());
        if (s.iframeTarget) {
            $io = $(s.iframeTarget);
            n = $io.attr2('name');
            if (!n)
                 $io.attr2('name', id);
            else
                id = n;
        }
        else {
            $io = $('<iframe name="' + id + '" src="'+ s.iframeSrc +'" />');
            $io.css({ position: 'absolute', top: '-1000px', left: '-1000px' });
        }
        io = $io[0];


        xhr = { // mock object
            aborted: 0,
            responseText: null,
            responseXML: null,
            status: 0,
            statusText: 'n/a',
            getAllResponseHeaders: function() {},
            getResponseHeader: function() {},
            setRequestHeader: function() {},
            abort: function(status) {
                var e = (status === 'timeout' ? 'timeout' : 'aborted');
                log('aborting upload... ' + e);
                this.aborted = 1;

                try { // #214, #257
                    if (io.contentWindow.document.execCommand) {
                        io.contentWindow.document.execCommand('Stop');
                    }
                }
                catch(ignore) {}

                $io.attr('src', s.iframeSrc); // abort op in progress
                xhr.error = e;
                if (s.error)
                    s.error.call(s.context, xhr, e, status);
                if (g)
                    $.event.trigger("ajaxError", [xhr, s, e]);
                if (s.complete)
                    s.complete.call(s.context, xhr, e);
            }
        };

        g = s.global;
        // trigger ajax global events so that activity/block indicators work like normal
        if (g && 0 === $.active++) {
            $.event.trigger("ajaxStart");
        }
        if (g) {
            $.event.trigger("ajaxSend", [xhr, s]);
        }

        if (s.beforeSend && s.beforeSend.call(s.context, xhr, s) === false) {
            if (s.global) {
                $.active--;
            }
            deferred.reject();
            return deferred;
        }
        if (xhr.aborted) {
            deferred.reject();
            return deferred;
        }

        // add submitting element to data if we know it
        sub = form.clk;
        if (sub) {
            n = sub.name;
            if (n && !sub.disabled) {
                s.extraData = s.extraData || {};
                s.extraData[n] = sub.value;
                if (sub.type == "image") {
                    s.extraData[n+'.x'] = form.clk_x;
                    s.extraData[n+'.y'] = form.clk_y;
                }
            }
        }

        var CLIENT_TIMEOUT_ABORT = 1;
        var SERVER_ABORT = 2;

        function getDoc(frame) {
            /* it looks like contentWindow or contentDocument do not
             * carry the protocol property in ie8, when running under ssl
             * frame.document is the only valid response document, since
             * the protocol is know but not on the other two objects. strange?
             * "Same origin policy" http://en.wikipedia.org/wiki/Same_origin_policy
             */

            var doc = null;

            // IE8 cascading access check
            try {
                if (frame.contentWindow) {
                    doc = frame.contentWindow.document;
                }
            } catch(err) {
                // IE8 access denied under ssl & missing protocol
                log('cannot get iframe.contentWindow document: ' + err);
            }

            if (doc) { // successful getting content
                return doc;
            }

            try { // simply checking may throw in ie8 under ssl or mismatched protocol
                doc = frame.contentDocument ? frame.contentDocument : frame.document;
            } catch(err) {
                // last attempt
                log('cannot get iframe.contentDocument: ' + err);
                doc = frame.document;
            }
            return doc;
        }

        // Rails CSRF hack (thanks to Yvan Barthelemy)
        var csrf_token = $('meta[name=csrf-token]').attr('content');
        var csrf_param = $('meta[name=csrf-param]').attr('content');
        if (csrf_param && csrf_token) {
            s.extraData = s.extraData || {};
            s.extraData[csrf_param] = csrf_token;
        }

        // take a breath so that pending repaints get some cpu time before the upload starts
        function doSubmit() {
            // make sure form attrs are set
            var t = $form.attr2('target'), a = $form.attr2('action');

            // update form attrs in IE friendly way
            form.setAttribute('target',id);
            if (!method) {
                form.setAttribute('method', 'POST');
            }
            if (a != s.url) {
                form.setAttribute('action', s.url);
            }

            // ie borks in some cases when setting encoding
            if (! s.skipEncodingOverride && (!method || /post/i.test(method))) {
                $form.attr({
                    encoding: 'multipart/form-data',
                    enctype:  'multipart/form-data'
                });
            }

            // support timout
            if (s.timeout) {
                timeoutHandle = setTimeout(function() { timedOut = true; cb(CLIENT_TIMEOUT_ABORT); }, s.timeout);
            }

            // look for server aborts
            function checkState() {
                try {
                    var state = getDoc(io).readyState;
                    log('state = ' + state);
                    if (state && state.toLowerCase() == 'uninitialized')
                        setTimeout(checkState,50);
                }
                catch(e) {
                    log('Server abort: ' , e, ' (', e.name, ')');
                    cb(SERVER_ABORT);
                    if (timeoutHandle)
                        clearTimeout(timeoutHandle);
                    timeoutHandle = undefined;
                }
            }

            // add "extra" data to form if provided in options
            var extraInputs = [];
            try {
                if (s.extraData) {
                    for (var n in s.extraData) {
                        if (s.extraData.hasOwnProperty(n)) {
                           // if using the $.param format that allows for multiple values with the same name
                           if($.isPlainObject(s.extraData[n]) && s.extraData[n].hasOwnProperty('name') && s.extraData[n].hasOwnProperty('value')) {
                               extraInputs.push(
                               $('<input type="hidden" name="'+s.extraData[n].name+'">').val(s.extraData[n].value)
                                   .appendTo(form)[0]);
                           } else {
                               extraInputs.push(
                               $('<input type="hidden" name="'+n+'">').val(s.extraData[n])
                                   .appendTo(form)[0]);
                           }
                        }
                    }
                }

                if (!s.iframeTarget) {
                    // add iframe to doc and submit the form
                    $io.appendTo('body');
                    if (io.attachEvent)
                        io.attachEvent('onload', cb);
                    else
                        io.addEventListener('load', cb, false);
                }
                setTimeout(checkState,15);

                try {
                    form.submit();
                } catch(err) {
                    // just in case form has element with name/id of 'submit'
                    var submitFn = document.createElement('form').submit;
                    submitFn.apply(form);
                }
            }
            finally {
                // reset attrs and remove "extra" input elements
                form.setAttribute('action',a);
                if(t) {
                    form.setAttribute('target', t);
                } else {
                    $form.removeAttr('target');
                }
                $(extraInputs).remove();
            }
        }

        if (s.forceSync) {
            doSubmit();
        }
        else {
            setTimeout(doSubmit, 10); // this lets dom updates render
        }

        var data, doc, domCheckCount = 50, callbackProcessed;

        function cb(e) {
            if (xhr.aborted || callbackProcessed) {
                return;
            }

            doc = getDoc(io);
            if(!doc) {
                log('cannot access response document');
                e = SERVER_ABORT;
            }
            if (e === CLIENT_TIMEOUT_ABORT && xhr) {
                xhr.abort('timeout');
                deferred.reject(xhr, 'timeout');
                return;
            }
            else if (e == SERVER_ABORT && xhr) {
                xhr.abort('server abort');
                deferred.reject(xhr, 'error', 'server abort');
                return;
            }

            if (!doc || doc.location.href == s.iframeSrc) {
                // response not received yet
                if (!timedOut)
                    return;
            }
            if (io.detachEvent)
                io.detachEvent('onload', cb);
            else
                io.removeEventListener('load', cb, false);

            var status = 'success', errMsg;
            try {
                if (timedOut) {
                    throw 'timeout';
                }

                var isXml = s.dataType == 'xml' || doc.XMLDocument || $.isXMLDoc(doc);
                log('isXml='+isXml);
                if (!isXml && window.opera && (doc.body === null || !doc.body.innerHTML)) {
                    if (--domCheckCount) {
                        // in some browsers (Opera) the iframe DOM is not always traversable when
                        // the onload callback fires, so we loop a bit to accommodate
                        log('requeing onLoad callback, DOM not available');
                        setTimeout(cb, 250);
                        return;
                    }
                    // let this fall through because server response could be an empty document
                    //log('Could not access iframe DOM after mutiple tries.');
                    //throw 'DOMException: not available';
                }

                //log('response detected');
                var docRoot = doc.body ? doc.body : doc.documentElement;
                xhr.responseText = docRoot ? docRoot.innerHTML : null;
                xhr.responseXML = doc.XMLDocument ? doc.XMLDocument : doc;
                if (isXml)
                    s.dataType = 'xml';
                xhr.getResponseHeader = function(header){
                    var headers = {'content-type': s.dataType};
                    return headers[header];
                };
                // support for XHR 'status' & 'statusText' emulation :
                if (docRoot) {
                    xhr.status = Number( docRoot.getAttribute('status') ) || xhr.status;
                    xhr.statusText = docRoot.getAttribute('statusText') || xhr.statusText;
                }

                var dt = (s.dataType || '').toLowerCase();
                var scr = /(json|script|text)/.test(dt);
                if (scr || s.textarea) {
                    // see if user embedded response in textarea
                    var ta = doc.getElementsByTagName('textarea')[0];
                    if (ta) {
                        xhr.responseText = ta.value;
                        // support for XHR 'status' & 'statusText' emulation :
                        xhr.status = Number( ta.getAttribute('status') ) || xhr.status;
                        xhr.statusText = ta.getAttribute('statusText') || xhr.statusText;
                    }
                    else if (scr) {
                        // account for browsers injecting pre around json response
                        var pre = doc.getElementsByTagName('pre')[0];
                        var b = doc.getElementsByTagName('body')[0];
                        if (pre) {
                            xhr.responseText = pre.textContent ? pre.textContent : pre.innerText;
                        }
                        else if (b) {
                            xhr.responseText = b.textContent ? b.textContent : b.innerText;
                        }
                    }
                }
                else if (dt == 'xml' && !xhr.responseXML && xhr.responseText) {
                    xhr.responseXML = toXml(xhr.responseText);
                }

                try {
                    data = httpData(xhr, dt, s);
                }
                catch (err) {
                    status = 'parsererror';
                    xhr.error = errMsg = (err || status);
                }
            }
            catch (err) {
                log('error caught: ',err);
                status = 'error';
                xhr.error = errMsg = (err || status);
            }

            if (xhr.aborted) {
                log('upload aborted');
                status = null;
            }

            if (xhr.status) { // we've set xhr.status
                status = (xhr.status >= 200 && xhr.status < 300 || xhr.status === 304) ? 'success' : 'error';
            }

            // ordering of these callbacks/triggers is odd, but that's how $.ajax does it
            if (status === 'success') {
                if (s.success)
                    s.success.call(s.context, data, 'success', xhr);
                deferred.resolve(xhr.responseText, 'success', xhr);
                if (g)
                    $.event.trigger("ajaxSuccess", [xhr, s]);
            }
            else if (status) {
                if (errMsg === undefined)
                    errMsg = xhr.statusText;
                if (s.error)
                    s.error.call(s.context, xhr, status, errMsg);
                deferred.reject(xhr, 'error', errMsg);
                if (g)
                    $.event.trigger("ajaxError", [xhr, s, errMsg]);
            }

            if (g)
                $.event.trigger("ajaxComplete", [xhr, s]);

            if (g && ! --$.active) {
                $.event.trigger("ajaxStop");
            }

            if (s.complete)
                s.complete.call(s.context, xhr, status);

            callbackProcessed = true;
            if (s.timeout)
                clearTimeout(timeoutHandle);

            // clean up
            setTimeout(function() {
                if (!s.iframeTarget)
                    $io.remove();
                xhr.responseXML = null;
            }, 100);
        }

        var toXml = $.parseXML || function(s, doc) { // use parseXML if available (jQuery 1.5+)
            if (window.ActiveXObject) {
                doc = new ActiveXObject('Microsoft.XMLDOM');
                doc.async = 'false';
                doc.loadXML(s);
            }
            else {
                doc = (new DOMParser()).parseFromString(s, 'text/xml');
            }
            return (doc && doc.documentElement && doc.documentElement.nodeName != 'parsererror') ? doc : null;
        };
        var parseJSON = $.parseJSON || function(s) {
            /*jslint evil:true */
            return window['eval']('(' + s + ')');
        };

        var httpData = function( xhr, type, s ) { // mostly lifted from jq1.4.4

            var ct = xhr.getResponseHeader('content-type') || '',
                xml = type === 'xml' || !type && ct.indexOf('xml') >= 0,
                data = xml ? xhr.responseXML : xhr.responseText;

            if (xml && data.documentElement.nodeName === 'parsererror') {
                if ($.error)
                    $.error('parsererror');
            }
            if (s && s.dataFilter) {
                data = s.dataFilter(data, type);
            }
            if (typeof data === 'string') {
                if (type === 'json' || !type && ct.indexOf('json') >= 0) {
                    data = parseJSON(data);
                } else if (type === "script" || !type && ct.indexOf("javascript") >= 0) {
                    $.globalEval(data);
                }
            }
            return data;
        };

        return deferred;
    }
};

/**
 * ajaxForm() provides a mechanism for fully automating form submission.
 *
 * The advantages of using this method instead of ajaxSubmit() are:
 *
 * 1: This method will include coordinates for <input type="image" /> elements (if the element
 *    is used to submit the form).
 * 2. This method will include the submit element's name/value data (for the element that was
 *    used to submit the form).
 * 3. This method binds the submit() method to the form for you.
 *
 * The options argument for ajaxForm works exactly as it does for ajaxSubmit.  ajaxForm merely
 * passes the options argument along after properly binding events for submit elements and
 * the form itself.
 */
$.fn.ajaxForm = function(options) {
    options = options || {};
    options.delegation = options.delegation && $.isFunction($.fn.on);

    // in jQuery 1.3+ we can fix mistakes with the ready state
    if (!options.delegation && this.length === 0) {
        var o = { s: this.selector, c: this.context };
        if (!$.isReady && o.s) {
            log('DOM not ready, queuing ajaxForm');
            $(function() {
                $(o.s,o.c).ajaxForm(options);
            });
            return this;
        }
        // is your DOM ready?  http://docs.jquery.com/Tutorials:Introducing_$(document).ready()
        log('terminating; zero elements found by selector' + ($.isReady ? '' : ' (DOM not ready)'));
        return this;
    }

    if ( options.delegation ) {
        $(document)
            .off('submit.form-plugin', this.selector, doAjaxSubmit)
            .off('click.form-plugin', this.selector, captureSubmittingElement)
            .on('submit.form-plugin', this.selector, options, doAjaxSubmit)
            .on('click.form-plugin', this.selector, options, captureSubmittingElement);
        return this;
    }

    return this.ajaxFormUnbind()
        .bind('submit.form-plugin', options, doAjaxSubmit)
        .bind('click.form-plugin', options, captureSubmittingElement);
};

// private event handlers
function doAjaxSubmit(e) {
    /*jshint validthis:true */
    var options = e.data;
    if (!e.isDefaultPrevented()) { // if event has been canceled, don't proceed
        e.preventDefault();
        $(this).ajaxSubmit(options);
    }
}

function captureSubmittingElement(e) {
    /*jshint validthis:true */
    var target = e.target;
    var $el = $(target);
    if (!($el.is("[type=submit],[type=image]"))) {
        // is this a child element of the submit el?  (ex: a span within a button)
        var t = $el.closest('[type=submit]');
        if (t.length === 0) {
            return;
        }
        target = t[0];
    }
    var form = this;
    form.clk = target;
    if (target.type == 'image') {
        if (e.offsetX !== undefined) {
            form.clk_x = e.offsetX;
            form.clk_y = e.offsetY;
        } else if (typeof $.fn.offset == 'function') {
            var offset = $el.offset();
            form.clk_x = e.pageX - offset.left;
            form.clk_y = e.pageY - offset.top;
        } else {
            form.clk_x = e.pageX - target.offsetLeft;
            form.clk_y = e.pageY - target.offsetTop;
        }
    }
    // clear form vars
    setTimeout(function() { form.clk = form.clk_x = form.clk_y = null; }, 100);
}


// ajaxFormUnbind unbinds the event handlers that were bound by ajaxForm
$.fn.ajaxFormUnbind = function() {
    return this.unbind('submit.form-plugin click.form-plugin');
};

/**
 * formToArray() gathers form element data into an array of objects that can
 * be passed to any of the following ajax functions: $.get, $.post, or load.
 * Each object in the array has both a 'name' and 'value' property.  An example of
 * an array for a simple login form might be:
 *
 * [ { name: 'username', value: 'jresig' }, { name: 'password', value: 'secret' } ]
 *
 * It is this array that is passed to pre-submit callback functions provided to the
 * ajaxSubmit() and ajaxForm() methods.
 */
$.fn.formToArray = function(semantic, elements) {
    var a = [];
    if (this.length === 0) {
        return a;
    }

    var form = this[0];
    var els = semantic ? form.getElementsByTagName('*') : form.elements;
    if (!els) {
        return a;
    }

    var i,j,n,v,el,max,jmax;
    for(i=0, max=els.length; i < max; i++) {
        el = els[i];
        n = el.name;
        if (!n || el.disabled) {
            continue;
        }

        if (semantic && form.clk && el.type == "image") {
            // handle image inputs on the fly when semantic == true
            if(form.clk == el) {
                a.push({name: n, value: $(el).val(), type: el.type });
                a.push({name: n+'.x', value: form.clk_x}, {name: n+'.y', value: form.clk_y});
            }
            continue;
        }

        v = $.fieldValue(el, true);
        if (v && v.constructor == Array) {
            if (elements)
                elements.push(el);
            for(j=0, jmax=v.length; j < jmax; j++) {
                a.push({name: n, value: v[j]});
            }
        }
        else if (feature.fileapi && el.type == 'file') {
            if (elements)
                elements.push(el);
            var files = el.files;
            if (files.length) {
                for (j=0; j < files.length; j++) {
                    a.push({name: n, value: files[j], type: el.type});
                }
            }
            else {
                // #180
                a.push({ name: n, value: '', type: el.type });
            }
        }
        else if (v !== null && typeof v != 'undefined') {
            if (elements)
                elements.push(el);
            a.push({name: n, value: v, type: el.type, required: el.required});
        }
    }

    if (!semantic && form.clk) {
        // input type=='image' are not found in elements array! handle it here
        var $input = $(form.clk), input = $input[0];
        n = input.name;
        if (n && !input.disabled && input.type == 'image') {
            a.push({name: n, value: $input.val()});
            a.push({name: n+'.x', value: form.clk_x}, {name: n+'.y', value: form.clk_y});
        }
    }
    return a;
};

/**
 * Serializes form data into a 'submittable' string. This method will return a string
 * in the format: name1=value1&amp;name2=value2
 */
$.fn.formSerialize = function(semantic) {
    //hand off to jQuery.param for proper encoding
    return $.param(this.formToArray(semantic));
};

/**
 * Serializes all field elements in the jQuery object into a query string.
 * This method will return a string in the format: name1=value1&amp;name2=value2
 */
$.fn.fieldSerialize = function(successful) {
    var a = [];
    this.each(function() {
        var n = this.name;
        if (!n) {
            return;
        }
        var v = $.fieldValue(this, successful);
        if (v && v.constructor == Array) {
            for (var i=0,max=v.length; i < max; i++) {
                a.push({name: n, value: v[i]});
            }
        }
        else if (v !== null && typeof v != 'undefined') {
            a.push({name: this.name, value: v});
        }
    });
    //hand off to jQuery.param for proper encoding
    return $.param(a);
};

/**
 * Returns the value(s) of the element in the matched set.  For example, consider the following form:
 *
 *  <form><fieldset>
 *      <input name="A" type="text" />
 *      <input name="A" type="text" />
 *      <input name="B" type="checkbox" value="B1" />
 *      <input name="B" type="checkbox" value="B2"/>
 *      <input name="C" type="radio" value="C1" />
 *      <input name="C" type="radio" value="C2" />
 *  </fieldset></form>
 *
 *  var v = $('input[type=text]').fieldValue();
 *  // if no values are entered into the text inputs
 *  v == ['','']
 *  // if values entered into the text inputs are 'foo' and 'bar'
 *  v == ['foo','bar']
 *
 *  var v = $('input[type=checkbox]').fieldValue();
 *  // if neither checkbox is checked
 *  v === undefined
 *  // if both checkboxes are checked
 *  v == ['B1', 'B2']
 *
 *  var v = $('input[type=radio]').fieldValue();
 *  // if neither radio is checked
 *  v === undefined
 *  // if first radio is checked
 *  v == ['C1']
 *
 * The successful argument controls whether or not the field element must be 'successful'
 * (per http://www.w3.org/TR/html4/interact/forms.html#successful-controls).
 * The default value of the successful argument is true.  If this value is false the value(s)
 * for each element is returned.
 *
 * Note: This method *always* returns an array.  If no valid value can be determined the
 *    array will be empty, otherwise it will contain one or more values.
 */
$.fn.fieldValue = function(successful) {
    for (var val=[], i=0, max=this.length; i < max; i++) {
        var el = this[i];
        var v = $.fieldValue(el, successful);
        if (v === null || typeof v == 'undefined' || (v.constructor == Array && !v.length)) {
            continue;
        }
        if (v.constructor == Array)
            $.merge(val, v);
        else
            val.push(v);
    }
    return val;
};

/**
 * Returns the value of the field element.
 */
$.fieldValue = function(el, successful) {
    var n = el.name, t = el.type, tag = el.tagName.toLowerCase();
    if (successful === undefined) {
        successful = true;
    }

    if (successful && (!n || el.disabled || t == 'reset' || t == 'button' ||
        (t == 'checkbox' || t == 'radio') && !el.checked ||
        (t == 'submit' || t == 'image') && el.form && el.form.clk != el ||
        tag == 'select' && el.selectedIndex == -1)) {
            return null;
    }

    if (tag == 'select') {
        var index = el.selectedIndex;
        if (index < 0) {
            return null;
        }
        var a = [], ops = el.options;
        var one = (t == 'select-one');
        var max = (one ? index+1 : ops.length);
        for(var i=(one ? index : 0); i < max; i++) {
            var op = ops[i];
            if (op.selected) {
                var v = op.value;
                if (!v) { // extra pain for IE...
                    v = (op.attributes && op.attributes['value'] && !(op.attributes['value'].specified)) ? op.text : op.value;
                }
                if (one) {
                    return v;
                }
                a.push(v);
            }
        }
        return a;
    }
    return $(el).val();
};

/**
 * Clears the form data.  Takes the following actions on the form's input fields:
 *  - input text fields will have their 'value' property set to the empty string
 *  - select elements will have their 'selectedIndex' property set to -1
 *  - checkbox and radio inputs will have their 'checked' property set to false
 *  - inputs of type submit, button, reset, and hidden will *not* be effected
 *  - button elements will *not* be effected
 */
$.fn.clearForm = function(includeHidden) {
    return this.each(function() {
        $('input,select,textarea', this).clearFields(includeHidden);
    });
};

/**
 * Clears the selected form elements.
 */
$.fn.clearFields = $.fn.clearInputs = function(includeHidden) {
    var re = /^(?:color|date|datetime|email|month|number|password|range|search|tel|text|time|url|week)$/i; // 'hidden' is not in this list
    return this.each(function() {
        var t = this.type, tag = this.tagName.toLowerCase();
        if (re.test(t) || tag == 'textarea') {
            this.value = '';
        }
        else if (t == 'checkbox' || t == 'radio') {
            this.checked = false;
        }
        else if (tag == 'select') {
            this.selectedIndex = -1;
        }
    else if (t == "file") {
      if (/MSIE/.test(navigator.userAgent)) {
        $(this).replaceWith($(this).clone(true));
      } else {
        $(this).val('');
      }
    }
        else if (includeHidden) {
            // includeHidden can be the value true, or it can be a selector string
            // indicating a special test; for example:
            //  $('#myForm').clearForm('.special:hidden')
            // the above would clean hidden inputs that have the class of 'special'
            if ( (includeHidden === true && /hidden/.test(t)) ||
                 (typeof includeHidden == 'string' && $(this).is(includeHidden)) )
                this.value = '';
        }
    });
};

/**
 * Resets the form data.  Causes all form elements to be reset to their original value.
 */
$.fn.resetForm = function() {
    return this.each(function() {
        // guard against an input with the name of 'reset'
        // note that IE reports the reset function as an 'object'
        if (typeof this.reset == 'function' || (typeof this.reset == 'object' && !this.reset.nodeType)) {
            this.reset();
        }
    });
};

/**
 * Enables or disables any matching elements.
 */
$.fn.enable = function(b) {
    if (b === undefined) {
        b = true;
    }
    return this.each(function() {
        this.disabled = !b;
    });
};

/**
 * Checks/unchecks any matching checkboxes or radio buttons and
 * selects/deselects and matching option elements.
 */
$.fn.selected = function(select) {
    if (select === undefined) {
        select = true;
    }
    return this.each(function() {
        var t = this.type;
        if (t == 'checkbox' || t == 'radio') {
            this.checked = select;
        }
        else if (this.tagName.toLowerCase() == 'option') {
            var $sel = $(this).parent('select');
            if (select && $sel[0] && $sel[0].type == 'select-one') {
                // deselect all other options
                $sel.find('option').selected(false);
            }
            this.selected = select;
        }
    });
};

// expose debug var
$.fn.ajaxSubmit.debug = false;

// helper fn for console logging
function log() {
    if (!$.fn.ajaxSubmit.debug)
        return;
    var msg = '[jquery.form] ' + Array.prototype.join.call(arguments,'');
    if (window.console && window.console.log) {
        window.console.log(msg);
    }
    else if (window.opera && window.opera.postError) {
        window.opera.postError(msg);
    }
}

});
/*!
 * jQuery throttle / debounce - v1.1 - 3/7/2010
 * http://benalman.com/projects/jquery-throttle-debounce-plugin/
 *
 * Copyright (c) 2010 "Cowboy" Ben Alman
 * Dual licensed under the MIT and GPL licenses.
 * http://benalman.com/about/license/
 */

// Script: jQuery throttle / debounce: Sometimes, less is more!
//
// *Version: 1.1, Last updated: 3/7/2010*
//
// Project Home - http://benalman.com/projects/jquery-throttle-debounce-plugin/
// GitHub       - http://github.com/cowboy/jquery-throttle-debounce/
// Source       - http://github.com/cowboy/jquery-throttle-debounce/raw/master/jquery.ba-throttle-debounce.js
// (Minified)   - http://github.com/cowboy/jquery-throttle-debounce/raw/master/jquery.ba-throttle-debounce.min.js (0.7kb)
//
// About: License
//
// Copyright (c) 2010 "Cowboy" Ben Alman,
// Dual licensed under the MIT and GPL licenses.
// http://benalman.com/about/license/
//
// About: Examples
//
// These working examples, complete with fully commented code, illustrate a few
// ways in which this plugin can be used.
//
// Throttle - http://benalman.com/code/projects/jquery-throttle-debounce/examples/throttle/
// Debounce - http://benalman.com/code/projects/jquery-throttle-debounce/examples/debounce/
//
// About: Support and Testing
//
// Information about what version or versions of jQuery this plugin has been
// tested with, what browsers it has been tested in, and where the unit tests
// reside (so you can test it yourself).
//
// jQuery Versions - none, 1.3.2, 1.4.2
// Browsers Tested - Internet Explorer 6-8, Firefox 2-3.6, Safari 3-4, Chrome 4-5, Opera 9.6-10.1.
// Unit Tests      - http://benalman.com/code/projects/jquery-throttle-debounce/unit/
//
// About: Release History
//
// 1.1 - (3/7/2010) Fixed a bug in <jQuery.throttle> where trailing callbacks
//       executed later than they should. Reworked a fair amount of internal
//       logic as well.
// 1.0 - (3/6/2010) Initial release as a stand-alone project. Migrated over
//       from jquery-misc repo v0.4 to jquery-throttle repo v1.0, added the
//       no_trailing throttle parameter and debounce functionality.

// Wrapped with amd define for InSales

(function(module) {
if (typeof(define) == 'function' && define.amd) {
  define('jquery.ba-throttle-debounce', ['jquery'], module);
} else {
  module(window.jQuery);
}})( function($) {
  // Method: jQuery.throttle
  //
  // Throttle execution of a function. Especially useful for rate limiting
  // execution of handlers on events like resize and scroll. If you want to
  // rate-limit execution of a function to a single time, see the
  // <jQuery.debounce> method.
  //
  // In this visualization, | is a throttled-function call and X is the actual
  // callback execution:
  //
  // > Throttled with `no_trailing` specified as false or unspecified:
  // > ||||||||||||||||||||||||| (pause) |||||||||||||||||||||||||
  // > X    X    X    X    X    X        X    X    X    X    X    X
  // >
  // > Throttled with `no_trailing` specified as true:
  // > ||||||||||||||||||||||||| (pause) |||||||||||||||||||||||||
  // > X    X    X    X    X             X    X    X    X    X
  //
  // Usage:
  //
  // > var throttled = jQuery.throttle( delay, [ no_trailing, ] callback );
  // >
  // > jQuery('selector').bind( 'someevent', throttled );
  // > jQuery('selector').unbind( 'someevent', throttled );
  //
  // This also works in jQuery 1.4+:
  //
  // > jQuery('selector').bind( 'someevent', jQuery.throttle( delay, [ no_trailing, ] callback ) );
  // > jQuery('selector').unbind( 'someevent', callback );
  //
  // Arguments:
  //
  //  delay - (Number) A zero-or-greater delay in milliseconds. For event
  //    callbacks, values around 100 or 250 (or even higher) are most useful.
  //  no_trailing - (Boolean) Optional, defaults to false. If no_trailing is
  //    true, callback will only execute every `delay` milliseconds while the
  //    throttled-function is being called. If no_trailing is false or
  //    unspecified, callback will be executed one final time after the last
  //    throttled-function call. (After the throttled-function has not been
  //    called for `delay` milliseconds, the internal counter is reset)
  //  callback - (Function) A function to be executed after delay milliseconds.
  //    The `this` context and all arguments are passed through, as-is, to
  //    `callback` when the throttled-function is executed.
  //
  // Returns:
  //
  //  (Function) A new, throttled, function.

  $.throttle = jq_throttle = function( delay, no_trailing, callback, debounce_mode ) {
    // After wrapper has stopped being called, this timeout ensures that
    // `callback` is executed at the proper times in `throttle` and `end`
    // debounce modes.
    var timeout_id,

      // Keep track of the last time `callback` was executed.
      last_exec = 0;

    // `no_trailing` defaults to falsy.
    if ( typeof no_trailing !== 'boolean' ) {
      debounce_mode = callback;
      callback = no_trailing;
      no_trailing = undefined;
    }

    // The `wrapper` function encapsulates all of the throttling / debouncing
    // functionality and when executed will limit the rate at which `callback`
    // is executed.
    function wrapper() {
      var that = this,
        elapsed = +new Date() - last_exec,
        args = arguments;

      // Execute `callback` and update the `last_exec` timestamp.
      function exec() {
        last_exec = +new Date();
        callback.apply( that, args );
      };

      // If `debounce_mode` is true (at_begin) this is used to clear the flag
      // to allow future `callback` executions.
      function clear() {
        timeout_id = undefined;
      };

      if ( debounce_mode && !timeout_id ) {
        // Since `wrapper` is being called for the first time and
        // `debounce_mode` is true (at_begin), execute `callback`.
        exec();
      }

      // Clear any existing timeout.
      timeout_id && clearTimeout( timeout_id );

      if ( debounce_mode === undefined && elapsed > delay ) {
        // In throttle mode, if `delay` time has been exceeded, execute
        // `callback`.
        exec();

      } else if ( no_trailing !== true ) {
        // In trailing throttle mode, since `delay` time has not been
        // exceeded, schedule `callback` to execute `delay` ms after most
        // recent execution.
        //
        // If `debounce_mode` is true (at_begin), schedule `clear` to execute
        // after `delay` ms.
        //
        // If `debounce_mode` is false (at end), schedule `callback` to
        // execute after `delay` ms.
        timeout_id = setTimeout( debounce_mode ? clear : exec, debounce_mode === undefined ? delay - elapsed : delay );
      }
    };

    // Set the guid of `wrapper` function to the same of original callback, so
    // it can be removed in jQuery 1.4+ .unbind or .die by using the original
    // callback as a reference.
    if ( $.guid ) {
      wrapper.guid = callback.guid = callback.guid || $.guid++;
    }

    // Return the wrapper function.
    return wrapper;
  };

  // Method: jQuery.debounce
  //
  // Debounce execution of a function. Debouncing, unlike throttling,
  // guarantees that a function is only executed a single time, either at the
  // very beginning of a series of calls, or at the very end. If you want to
  // simply rate-limit execution of a function, see the <jQuery.throttle>
  // method.
  //
  // In this visualization, | is a debounced-function call and X is the actual
  // callback execution:
  //
  // > Debounced with `at_begin` specified as false or unspecified:
  // > ||||||||||||||||||||||||| (pause) |||||||||||||||||||||||||
  // >                          X                                 X
  // >
  // > Debounced with `at_begin` specified as true:
  // > ||||||||||||||||||||||||| (pause) |||||||||||||||||||||||||
  // > X                                 X
  //
  // Usage:
  //
  // > var debounced = jQuery.debounce( delay, [ at_begin, ] callback );
  // >
  // > jQuery('selector').bind( 'someevent', debounced );
  // > jQuery('selector').unbind( 'someevent', debounced );
  //
  // This also works in jQuery 1.4+:
  //
  // > jQuery('selector').bind( 'someevent', jQuery.debounce( delay, [ at_begin, ] callback ) );
  // > jQuery('selector').unbind( 'someevent', callback );
  //
  // Arguments:
  //
  //  delay - (Number) A zero-or-greater delay in milliseconds. For event
  //    callbacks, values around 100 or 250 (or even higher) are most useful.
  //  at_begin - (Boolean) Optional, defaults to false. If at_begin is false or
  //    unspecified, callback will only be executed `delay` milliseconds after
  //    the last debounced-function call. If at_begin is true, callback will be
  //    executed only at the first debounced-function call. (After the
  //    throttled-function has not been called for `delay` milliseconds, the
  //    internal counter is reset)
  //  callback - (Function) A function to be executed after delay milliseconds.
  //    The `this` context and all arguments are passed through, as-is, to
  //    `callback` when the debounced-function is executed.
  //
  // Returns:
  //
  //  (Function) A new, debounced, function.

  $.debounce = function( delay, at_begin, callback ) {
    return callback === undefined
      ? jq_throttle( delay, at_begin, false )
      : jq_throttle( delay, callback, at_begin !== false );
  };

});
(function() {
  $('head').prepend("<style>\n  .spinner-container, .spinner {\n    position: absolute;\n    left:     0;\n    bottom:   0;\n    height:   100%;\n    width:    100%;\n  }\n\n  .spinner-container {\n    z-index:  900;\n    overflow: hidden;\n\n    &.animate .spinner {\n      &.slide-up {\n        opacity: 0;\n      }\n\n      &.fade-in {\n        opacity: 0;\n      }\n    }\n  }\n\n  .spinner {\n    height:   100%;\n    opacity:  0.6;\n    background: #fff;\n\n    &.slide-up {\n      @include transition-property(opacity, bottom);\n      @include transition-duration(0.3s);\n    }\n\n    &.fade-in {\n      @include transition-property(opacity);\n      @include transition-duration(1s);\n    }\n\n    .spin {\n      position: absolute;\n      top: 50%;\n      left: 50%;\n    }\n  }\n\n\n  .spinner {\n    background: rgba(255, 255, 255, 0);\n  }\n\n  .spinner-screen {\n    position: fixed;\n    z-index: 10000;\n    height: 100%;\n    width: 100%;\n  }\n</style>");

}).call(this);
/**
 * Copyright (c) 2011-2014 Felix Gnass
 * Licensed under the MIT license
 */

(function(root, factory) {
  root.Spinner = factory()
}
(this, function() {
  "use strict";

  var prefixes = ['webkit', 'Moz', 'ms', 'O'] /* Vendor prefixes */
    , animations = {} /* Animation rules keyed by their name */
    , useCssAnimations /* Whether to use CSS animations or setTimeout */

  /**
   * Utility function to create elements. If no tag name is given,
   * a DIV is created. Optionally properties can be passed.
   */
  function createEl(tag, prop) {
    var el = document.createElement(tag || 'div')
      , n

    for(n in prop) el[n] = prop[n]
    return el
  }

  /**
   * Appends children and returns the parent.
   */
  function ins(parent /* child1, child2, ...*/) {
    for (var i=1, n=arguments.length; i<n; i++)
      parent.appendChild(arguments[i])

    return parent
  }

  /**
   * Insert a new stylesheet to hold the @keyframe or VML rules.
   */
  var sheet = (function() {
    var el = createEl('style', {type : 'text/css'})
    ins(document.getElementsByTagName('head')[0], el)
    return el.sheet || el.styleSheet
  }())

  /**
   * Creates an opacity keyframe animation rule and returns its name.
   * Since most mobile Webkits have timing issues with animation-delay,
   * we create separate rules for each line/segment.
   */
  function addAnimation(alpha, trail, i, lines) {
    var name = ['opacity', trail, ~~(alpha*100), i, lines].join('-')
      , start = 0.01 + i/lines * 100
      , z = Math.max(1 - (1-alpha) / trail * (100-start), alpha)
      , prefix = useCssAnimations.substring(0, useCssAnimations.indexOf('Animation')).toLowerCase()
      , pre = prefix && '-' + prefix + '-' || ''

    if (!animations[name]) {
      sheet.insertRule(
        '@' + pre + 'keyframes ' + name + '{' +
        '0%{opacity:' + z + '}' +
        start + '%{opacity:' + alpha + '}' +
        (start+0.01) + '%{opacity:1}' +
        (start+trail) % 100 + '%{opacity:' + alpha + '}' +
        '100%{opacity:' + z + '}' +
        '}', sheet.cssRules.length)

      animations[name] = 1
    }

    return name
  }

  /**
   * Tries various vendor prefixes and returns the first supported property.
   */
  function vendor(el, prop) {
    var s = el.style
      , pp
      , i

    prop = prop.charAt(0).toUpperCase() + prop.slice(1)
    for(i=0; i<prefixes.length; i++) {
      pp = prefixes[i]+prop
      if(s[pp] !== undefined) return pp
    }
    if(s[prop] !== undefined) return prop
  }

  /**
   * Sets multiple style properties at once.
   */
  function css(el, prop) {
    for (var n in prop)
      el.style[vendor(el, n)||n] = prop[n]

    return el
  }

  /**
   * Fills in default values.
   */
  function merge(obj) {
    for (var i=1; i < arguments.length; i++) {
      var def = arguments[i]
      for (var n in def)
        if (obj[n] === undefined) obj[n] = def[n]
    }
    return obj
  }

  /**
   * Returns the absolute page-offset of the given element.
   */
  function pos(el) {
    var o = { x:el.offsetLeft, y:el.offsetTop }
    while((el = el.offsetParent))
      o.x+=el.offsetLeft, o.y+=el.offsetTop

    return o
  }

  /**
   * Returns the line color from the given string or array.
   */
  function getColor(color, idx) {
    return typeof color == 'string' ? color : color[idx % color.length]
  }

  // Built-in defaults

  var defaults = {
    lines: 12,            // The number of lines to draw
    length: 7,            // The length of each line
    width: 5,             // The line thickness
    radius: 10,           // The radius of the inner circle
    rotate: 0,            // Rotation offset
    corners: 1,           // Roundness (0..1)
    color: '#000',        // #rgb or #rrggbb
    direction: 1,         // 1: clockwise, -1: counterclockwise
    speed: 1,             // Rounds per second
    trail: 100,           // Afterglow percentage
    opacity: 1/4,         // Opacity of the lines
    fps: 20,              // Frames per second when using setTimeout()
    zIndex: 2e9,          // Use a high z-index by default
    className: 'spinner', // CSS class to assign to the element
    top: '50%',           // center vertically
    left: '50%',          // center horizontally
    position: 'absolute'  // element position
  }

  /** The constructor */
  function Spinner(o) {
    this.opts = merge(o || {}, Spinner.defaults, defaults)
  }

  // Global defaults that override the built-ins:
  Spinner.defaults = {}

  merge(Spinner.prototype, {

    /**
     * Adds the spinner to the given target element. If this instance is already
     * spinning, it is automatically removed from its previous target b calling
     * stop() internally.
     */
    spin: function(target) {
      this.stop()

      var self = this
        , o = self.opts
        , el = self.el = css(createEl(0, {className: o.className}), {position: o.position, width: 0, zIndex: o.zIndex})
        , mid = o.radius+o.length+o.width

      css(el, {
        left: o.left,
        top: o.top
      })

      if (target) {
        target.insertBefore(el, target.firstChild||null)
      }

      el.setAttribute('role', 'progressbar')
      self.lines(el, self.opts)

      if (!useCssAnimations) {
        // No CSS animation support, use setTimeout() instead
        var i = 0
          , start = (o.lines - 1) * (1 - o.direction) / 2
          , alpha
          , fps = o.fps
          , f = fps/o.speed
          , ostep = (1-o.opacity) / (f*o.trail / 100)
          , astep = f/o.lines

        ;(function anim() {
          i++;
          for (var j = 0; j < o.lines; j++) {
            alpha = Math.max(1 - (i + (o.lines - j) * astep) % f * ostep, o.opacity)

            self.opacity(el, j * o.direction + start, alpha, o)
          }
          self.timeout = self.el && setTimeout(anim, ~~(1000/fps))
        })()
      }
      return self
    },

    /**
     * Stops and removes the Spinner.
     */
    stop: function() {
      var el = this.el
      if (el) {
        clearTimeout(this.timeout)
        if (el.parentNode) el.parentNode.removeChild(el)
        this.el = undefined
      }
      return this
    },

    /**
     * Internal method that draws the individual lines. Will be overwritten
     * in VML fallback mode below.
     */
    lines: function(el, o) {
      var i = 0
        , start = (o.lines - 1) * (1 - o.direction) / 2
        , seg

      function fill(color, shadow) {
        return css(createEl(), {
          position: 'absolute',
          width: (o.length+o.width) + 'px',
          height: o.width + 'px',
          background: color,
          boxShadow: shadow,
          transformOrigin: 'left',
          transform: 'rotate(' + ~~(360/o.lines*i+o.rotate) + 'deg) translate(' + o.radius+'px' +',0)',
          borderRadius: (o.corners * o.width>>1) + 'px'
        })
      }

      for (; i < o.lines; i++) {
        seg = css(createEl(), {
          position: 'absolute',
          top: 1+~(o.width/2) + 'px',
          transform: o.hwaccel ? 'translate3d(0,0,0)' : '',
          opacity: o.opacity,
          animation: useCssAnimations && addAnimation(o.opacity, o.trail, start + i * o.direction, o.lines) + ' ' + 1/o.speed + 's linear infinite'
        })

        if (o.shadow) ins(seg, css(fill('#000', '0 0 4px ' + '#000'), {top: 2+'px'}))
        ins(el, ins(seg, fill(getColor(o.color, i), '0 0 1px rgba(0,0,0,.1)')))
      }
      return el
    },

    /**
     * Internal method that adjusts the opacity of a single line.
     * Will be overwritten in VML fallback mode below.
     */
    opacity: function(el, i, val) {
      if (i < el.childNodes.length) el.childNodes[i].style.opacity = val
    }

  })


  function initVML() {

    /* Utility function to create a VML tag */
    function vml(tag, attr) {
      return createEl('<' + tag + ' xmlns="urn:schemas-microsoft.com:vml" class="spin-vml">', attr)
    }

    // No CSS transforms but VML support, add a CSS rule for VML elements:
    sheet.addRule('.spin-vml', 'behavior:url(#default#VML)')

    Spinner.prototype.lines = function(el, o) {
      var r = o.length+o.width
        , s = 2*r

      function grp() {
        return css(
          vml('group', {
            coordsize: s + ' ' + s,
            coordorigin: -r + ' ' + -r
          }),
          { width: s, height: s }
        )
      }

      var margin = -(o.width+o.length)*2 + 'px'
        , g = css(grp(), {position: 'absolute', top: margin, left: margin})
        , i

      function seg(i, dx, filter) {
        ins(g,
          ins(css(grp(), {rotation: 360 / o.lines * i + 'deg', left: ~~dx}),
            ins(css(vml('roundrect', {arcsize: o.corners}), {
                width: r,
                height: o.width,
                left: o.radius,
                top: -o.width>>1,
                filter: filter
              }),
              vml('fill', {color: getColor(o.color, i), opacity: o.opacity}),
              vml('stroke', {opacity: 0}) // transparent stroke to fix color bleeding upon opacity change
            )
          )
        )
      }

      if (o.shadow)
        for (i = 1; i <= o.lines; i++)
          seg(i, -2, 'progid:DXImageTransform.Microsoft.Blur(pixelradius=2,makeshadow=1,shadowopacity=.3)')

      for (i = 1; i <= o.lines; i++) seg(i)
      return ins(el, g)
    }

    Spinner.prototype.opacity = function(el, i, val, o) {
      var c = el.firstChild
      o = o.shadow && o.lines || 0
      if (c && i+o < c.childNodes.length) {
        c = c.childNodes[i+o]; c = c && c.firstChild; c = c && c.firstChild
        if (c) c.opacity = val
      }
    }
  }

  var probe = css(createEl('group'), {behavior: 'url(#default#VML)'})

  if (!vendor(probe, 'transform') && probe.adj) initVML()
  else useCssAnimations = vendor(probe, 'animation')

  return Spinner

}));
(function() {
  (function($) {
    var ANIMATION_DURATION, Spinner, data_index, plugin_name, spinner_target;
    plugin_name = 'spinner';
    data_index = plugin_name + ".instance";
    ANIMATION_DURATION = 500;
    $[plugin_name] = Spinner = (function() {
      function Spinner(element, options1) {
        var css, selector;
        this.element = element;
        this.options = options1 != null ? options1 : {};
        this.target = (selector = this.element.data('spinner-target')) ? this.element.find(selector) : this.element;
        css = {};
        if (this.target.css('position') === 'static') {
          css.position = 'relative';
        }
        if (this.target.css('z-index') === 'auto') {
          css['z-index'] = 'inherit';
        }
        this.target.css(css);
      }

      Spinner.prototype.start = function(options) {
        var s;
        if (options == null) {
          options = {};
        }
        s = this.spinnerContainer();
        if (options.delayed) {
          s.queue((function(_this) {
            return function() {
              return s.addClass('transparent').addClass('animate').appendTo(_this.target).delay(options.delayed).dequeue();
            };
          })(this));
          s.queue(function() {
            return s.removeClass('transparent').delay(10).dequeue();
          });
        } else {
          s.queue((function(_this) {
            return function() {
              return s.addClass('animate').appendTo(_this.target).delay(10).dequeue();
            };
          })(this));
        }
        return s.queue(function() {
          return s.removeClass('animate').delay(ANIMATION_DURATION).dequeue();
        });
      };

      Spinner.prototype.stop = function() {
        var s;
        s = this.spinnerContainer();
        if (s.hasClass('transparent')) {
          return s.clearQueue().detach();
        } else {
          return s.queue(function() {
            return s.addClass('animate').delay(ANIMATION_DURATION).dequeue();
          }).queue(function() {
            return s.removeClass('animate').detach().dequeue();
          });
        }
      };

      Spinner.prototype.spinnerContainer = function() {
        var animation, default_spin_options, height, length, radius, spin, width;
        if (!this._spinnerContainer) {
          height = this.target.height();
          if (height > 80) {
            height = 80;
          }
          radius = height * 0.15;
          length = radius * 1;
          width = radius < 7 ? 2 : 3;
          default_spin_options = {
            color: 'black',
            lines: 12,
            className: 'spin',
            radius: radius,
            length: length,
            width: width
          };
          spin = new window.Spinner($.extend(default_spin_options, this.options.spin));
          animation = this.options.animation || 'slide-up';
          this._spinnerContainer = $('<div class="spinner-container">').append($("<div class='spinner " + animation + "'>").append(spin.spin().el));
        }
        return this._spinnerContainer;
      };

      return Spinner;

    })();
    $.fn[plugin_name] = function(action, options) {
      if (typeof action === 'object') {
        options = action;
        action = null;
      }
      return this.each(function() {
        var $this, instance;
        $this = $(this);
        if (!(instance = $this.data(data_index))) {
          instance = new $[plugin_name]($this, options);
          $this.data(data_index, instance);
        }
        if (action) {
          return instance[action](options);
        }
      });
    };
    spinner_target = function(el) {
      var $el, selector;
      $el = $(el);
      if (selector = $el.data('remote-spinner')) {
        return $(selector);
      } else {
        return $el;
      }
    };
    return setTimeout((function() {
      return new window.Spinner().spin();
    }), 1000);
  })(jQuery);

}).call(this);
(function() {
  var hasProp = {}.hasOwnProperty;

  define('shop/checkout/views/checkout', ['jquery'], function($) {
    var CheckoutView;
    CheckoutView = {
      deliveries: {},
      emailRequiredWas: null,
      init: function() {
        var disable_create_order_button, disable_event_target, enable_create_order_button, enable_event_target;
        console.log('CheckoutView: init');
        this.switchClientType($('.co-customer .co-tabs-node--active'));
        this.switchEmailRequiredMark();
        $(document).on('click', '#register', (function(_this) {
          return function(e) {
            $('.co-customer .co-input--password').toggleClass('not-register');
            return $('.co-customer .co-input--password_confirmation').toggleClass('not-register');
          };
        })(this));
        $(document).on('disable:insales:delivery', (function(_this) {
          return function(e) {
            var delivery, deliveryId;
            deliveryId = $(e.target).data('deliveryId');
            delivery = _this.deliveries[deliveryId];
            if (delivery) {
              delivery.not_available = true;
            }
            return _this.checkDeliveryAvailability();
          };
        })(this));
        $(document).on('click', '.co-customer .co-tabs-node', (function(_this) {
          return function(e) {
            return _this.switchClientType($(e.currentTarget));
          };
        })(this));
        $(document).on('click', '.not_available :radio', function(e) {
          e.preventDefault();
          e.stopImmediatePropagation();
          return false;
        });
        disable_create_order_button = function() {
          return $('#create_order').prop("disabled", "disabled");
        };
        enable_create_order_button = function() {
          return $('#create_order').prop("disabled", false);
        };
        $(document).on('loading:insales:payments', (function(_this) {
          return function(e) {
            disable_create_order_button();
            return $('.payment_variants').spinner('start');
          };
        })(this));
        $(document).on('loaded:insales:payments', (function(_this) {
          return function(e, payments) {
            var ref;
            enable_create_order_button();
            $('.payment_variants').spinner('stop');
            payments || (payments = (ref = e.originalEvent) != null ? ref.detail : void 0);
            _this.hidePaymentNotAvailable();
            if ($.isEmptyObject(payments)) {
              return _this.showPaymentNotAvailable();
            }
          };
        })(this));
        $(document).on('loading:insales:deliveries', function(e) {
          disable_create_order_button();
          return $('.delivery_variants').spinner('start');
        });
        $(document).on('loaded:insales:deliveries', (function(_this) {
          return function(e, loadedDeliveries) {
            var ref;
            loadedDeliveries || (loadedDeliveries = (ref = e.originalEvent) != null ? ref.detail : void 0);
            _this.deliveries = loadedDeliveries;
            return _this.checkDeliveryAvailability();
          };
        })(this));
        $(document).on('inited:insales:deliveries', (function(_this) {
          return function(e, deliveries) {
            $('#create_order').prop("disabled", false);
            return $('.delivery_variants').spinner('stop');
          };
        })(this));
        $(document).on('updated:insales:checkout:delivery selected:insales:checkout:delivery', (function(_this) {
          return function(e, order) {
            var ref, ref1;
            order || (order = (ref = e.originalEvent) != null ? ref.detail : void 0);
            _this.drawTotalPrice(_this.calculateTotalPrice(order));
            return _this.drawDeliveryPrice((ref1 = order.delivery) != null ? ref1.price : void 0);
          };
        })(this));
        $(document).on('updated:insales:checkout:payment selected:insales:checkout:payment', (function(_this) {
          return function(e, order) {
            var ref, ref1;
            order || (order = (ref = e.originalEvent) != null ? ref.detail : void 0);
            _this.drawTotalPrice(_this.calculateTotalPrice(order));
            return _this.drawPaymentPrice((ref1 = order.payment) != null ? ref1.price : void 0);
          };
        })(this));
        $(document).on('loading:fail:insales:deliveries', (function(_this) {
          return function() {
            $('#create_order').prop("disabled", false);
            $('.delivery_variants').spinner('stop');
            if ($('#delivery_variants input[id^="order_delivery_variant_id_"]:radio:checked').length === 0) {
              $('#delivery_variants input[id^="order_delivery_variant_id_"]:radio').first().attr('checked', 'checked');
            }
            return $('#delivery_variants input[id^="order_delivery_variant_id_"]:radio').each(function(k, v) {
              return _this.enableElement($(v));
            });
          };
        })(this));
        $(document).on('loading:fail:insales:payments', (function(_this) {
          return function() {
            $('#create_order').prop("disabled", false);
            $('.payment_variants').spinner('stop');
            $('#payment_gateways input[id^="order_payment_gateway_id_"]:radio').each(function(k, v) {
              return _this.enableElement($(v));
            });
            if ($('#payment_gateways input[id^="order_payment_gateway_id_"]:radio:checked').length === 0) {
              return $('#payment_gateways input[id^="order_payment_gateway_id_"]:radio').first().attr('checked', 'checked');
            }
          };
        })(this));
        $(document).on('hide:insales:delivery', (function(_this) {
          return function(e) {
            return $(e.target).closest('.co-input-wrapper').fadeOut('slow', function() {});
          };
        })(this));
        $(document).on('show:insales:delivery', (function(_this) {
          return function(e) {
            return $(e.target).closest('.co-input-wrapper').fadeIn('slow');
          };
        })(this));
        disable_event_target = (function(_this) {
          return function(e) {
            return _this.disableElement($(e.target));
          };
        })(this);
        enable_event_target = (function(_this) {
          return function(e) {
            return _this.enableElement($(e.target));
          };
        })(this);
        $(document).on('enable:insales:delivery enable:insales:payment', enable_event_target);
        $(document).on('disable:insales:delivery', disable_event_target);
        $(document).on('disable:insales:payment', disable_event_target);
        if ($('#save_as_default').length > 0) {
          $(document).on('change', '#delivery_address', function() {
            $('#save_as_default').show();
            return $('#save_address_as_default').attr('checked', true);
          });
        }
        $(document).on('change', 'select[data-order-client-type]', function() {
          var params;
          params = {
            url: '/orders/change_client_type.json',
            data: $(this).closest('form').serializeArray(),
            dataType: "json",
            method: 'PUT'
          };
          return $.ajax(params).complete(function() {
            return window.location.reload();
          });
        });
        $(document).on('change', '#register', (function(_this) {
          return function(e) {
            return _this.switchEmailRequiredMark();
          };
        })(this));
        return $(document).on('selected:insales:delivery', '[data-checkout2]', (function(_this) {
          return function(e, data) {
            var ref;
            data || (data = (ref = e.originalEvent) != null ? ref.detail : void 0);
            return _this.switchDeliveryType(data.customer_pickup);
          };
        })(this));
      },
      switchEmailRequiredMark: function() {
        var $clientEmail, emailRequired;
        $clientEmail = $('#client_email').closest('.co-input, .field.fc');
        if (this.emailRequiredWas === null) {
          this.emailRequiredWas = $clientEmail.hasClass('co-input--required') || $clientEmail.hasClass('input--required');
        }
        emailRequired = $('input[type=checkbox][name="client[registered]"]').last().is(':checked');
        if ($('input[type=checkbox][name="client[registered]"]').length === 0) {
          emailRequired = parseInt($('#client_registered').val());
        }
        if (emailRequired) {
          return $clientEmail.addClass('co-input--required').addClass('input--required');
        }
        $clientEmail.removeClass('co-input--required').removeClass('input--required');
        if (this.emailRequiredWas) {
          return $clientEmail.addClass('co-input--required').addClass('input--required');
        }
      },
      switchClientType: function($current) {
        var activeTab, passiveTab;
        if (!$current || $current.length === 0) {
          return;
        }
        activeTab = $current.data('target');
        passiveTab = activeTab === '#tabs-person' ? '#tabs-organization' : '#tabs-person';
        if (activeTab === '#tabs-organization') {
          $(document).find(".consent_to_personal_data_checkbox").hide();
        } else {
          $(document).find(".consent_to_personal_data_checkbox").show();
        }
        $(activeTab).find(':input').prop('disabled', false);
        $(passiveTab).find(':input').prop('disabled', true);
        return $(document).trigger('switch_mask:insales:checkout');
      },
      switchDeliveryType: function(isPickUp) {
        if (isPickUp) {
          $('#shipping_address_no_delivery').prop('checked', true);
          $('#shipping_address').hide();
          return $('#shipping_address_address, #shipping_address_street, #shipping_address_house, #shipping_address_flat, #shipping_address_zip').prop('disabled', true);
        } else {
          $('#shipping_address_no_delivery').prop('checked', false);
          $('#shipping_address_address, #shipping_address_street, #shipping_address_house, #shipping_address_flat, #shipping_address_zip').prop('disabled', false);
          return $('#shipping_address').show();
        }
      },
      checkDeliveryAvailability: function() {
        var availableDeliveries, delivery, key, ref;
        this.hideDeliveryNotAvailable();
        availableDeliveries = [];
        ref = this.deliveries;
        for (key in ref) {
          if (!hasProp.call(ref, key)) continue;
          delivery = ref[key];
          if (!delivery.not_available) {
            availableDeliveries.push(delivery);
          }
        }
        if (availableDeliveries.length === 0) {
          this.showDeliveryNotAvailable();
          $('#hidden-data').html();
          $('.delivery_variants').find(':radio').prop('checked', false);
          $(document).trigger('loading:insales:payments');
          return $(document).trigger('loaded:insales:payments');
        }
      },
      showDeliveryNotAvailable: function() {
        $("#deliveries-not-available").show();
        if ($("#deliveries-not-available-input").length === 0) {
          return $("#deliveries-not-available").prepend('<input id="deliveries-not-available-input" type="hidden" name="order[delivery_variant_id]" value="">');
        }
      },
      hideDeliveryNotAvailable: function() {
        $("#deliveries-not-available").hide();
        return $("#deliveries-not-available-input").remove();
      },
      showPaymentNotAvailable: function() {
        $('#payments-not-available').show();
        if ($('#payments-not-available-input').length === 0) {
          return $('#payments-not-available').prepend('<input id="payments-not-available-input" type="hidden" name="order[payment_gateway_id]" value="">');
        }
      },
      hidePaymentNotAvailable: function() {
        $('#payments-not-available').hide();
        return $('#payments-not-available-input').remove();
      },
      disableElement: function($target) {
        $target.css({
          'cursor': 'not-allowed'
        });
        $target.css({
          'opacity': 0.4
        });
        return $target.attr('checked', false).parents('.co-input-wrapper').addClass('not_available').find('.price label span').text('').attr('data-price', 0).end().find('div[id^="delivery_error_"]').hide();
      },
      enableElement: function($target) {
        $target.css({
          'cursor': 'pointer'
        });
        $target.css({
          'opacity': 1
        });
        return $target.parents('.co-input-wrapper').removeClass('not_available');
      },
      calculateTotalPrice: function(order) {
        var ref, ref1;
        return order.items_price + (((ref = order.payment) != null ? ref.price : void 0) || 0) + (((ref1 = order.delivery) != null ? ref1.price : void 0) || 0);
      },
      drawTotalPrice: function(totalPrice) {
        return (totalPrice != null) && $('#total_price').html(InSales.formatMoney(totalPrice));
      },
      drawDeliveryPrice: function(deliveryPrice) {
        if (deliveryPrice != null) {
          $('#delivery_price').html(InSales.formatMoney(deliveryPrice));
          return $('#delivery_price_unformatted').html(deliveryPrice);
        }
      },
      drawPaymentPrice: function(paymentPrice) {
        var val;
        if (paymentPrice) {
          val = InSales.formatMoney(Math.abs(paymentPrice));
          if (paymentPrice < 0) {
            val = '- ' + val;
          }
          $('#payment_gateway_price').html(val);
          return $('#payment_way_block').show();
        } else {
          return $('#payment_way_block').hide();
        }
      }
    };
    return CheckoutView;
  });

}).call(this);
(function() {
  define('shop/checkout/bonus_points', ['jquery'], function($) {
    var BonusPoints;
    BonusPoints = {
      ready: false,
      available: null,
      max: null,
      init: function() {
        var element, field, that;
        console.log('BonusPoints: init');
        that = this;
        element = $('#use_max_bonus_points');
        this.max = parseInt(element.data('maxBonusPoints'));
        this.available = parseInt(element.data('availableBonusPoints'));
        this.set_field_state();
        $('#order_use_bonus_points').on('click', function() {
          that.set_visibility();
          that.set_field_state();
          return that.trigger_updated_event();
        });
        $('#use_max_bonus_points').on('click', function() {
          return that.set_bonuses(that.max);
        });
        field = $('#order_client_bonus_points');
        field.on('change', function() {
          return that.set_bonuses(field.val());
        });
        return this.ready = true;
      },
      set_bonuses: function(value) {
        value = Math.min(value, this.available, this.max);
        $('#order_client_bonus_points').val(value);
        return this.trigger_updated_event();
      },
      set_field_state: function() {
        return $('.bonus_points :input').attr('disabled', !this.is_enabled());
      },
      set_visibility: function() {
        if (this.is_enabled()) {
          return $('.bonus_points').show();
        } else {
          return $('.bonus_points').hide();
        }
      },
      is_enabled: function() {
        return $('#order_use_bonus_points').attr('checked');
      },
      trigger_updated_event: function() {
        return $(document).triggerCustom('updated:insales:checkout:bonus_points');
      }
    };
    return BonusPoints;
  });

}).call(this);
(function() {
  define('shop/checkout/api_helpers', ['jquery'], function($) {
    var add_commas, get_numeric, no_delivery, set_message;
    no_delivery = function(check_box) {
      var address_elements;
      address_elements = $('#shipping_address_address, #shipping_address_zip');
      if (check_box.prop('checked')) {
        address_elements.prop('disabled', true);
        return check_box.removeAttr('disabled');
      } else {
        return address_elements.removeAttr('disabled');
      }
    };
    set_message = function(obj, message_type, message) {
      $('#enter_password').next('.error').remove();
      return $('#enter_password').after("<div class='" + message_type + "' style='color:red'>" + message + "</div>");
    };
    add_commas = function(nStr) {
      var rgx, x, x1, x2;
      x = (nStr + '').split('.');
      x1 = x[0];
      x2 = x.length > 1 ? "." + x[1] : "";
      rgx = /(\d+)(\d{3})/;
      while (rgx.test(x1)) {
        x1 = x1.replace(rgx, "$1&nbsp;$2");
      }
      return x1 + x2;
    };
    get_numeric = function(text) {
      if (text) {
        return Number(text.replace(/(?:,| |&nbsp;)/g, ""));
      } else {
        return 0;
      }
    };
    return {
      set_message: set_message,
      add_commas: add_commas,
      get_numeric: get_numeric,
      no_delivery: no_delivery
    };
  });

}).call(this);
(function() {
  var module_deps;

  module_deps = ['jquery', 'shop/checkout/views/checkout', 'shop/checkout/bonus_points', 'shop/checkout/discounts', 'shop/checkout/api_helpers'];

  define('shop/checkout/checkout', module_deps, function($, CheckoutView, BonusPoints, Discounts, api_helpers) {
    var Checkout, add_commas, get_numeric, no_delivery, set_message;
    set_message = api_helpers.set_message, add_commas = api_helpers.add_commas, get_numeric = api_helpers.get_numeric, no_delivery = api_helpers.no_delivery;
    Checkout = {
      order: {},
      init: function() {
        var sendFormButton, that;
        console.log('Checkout: init');
        that = this;
        sendFormButton = $('#create_order, #set_delivery').get(0);
        if (sendFormButton) {
          sendFormButton.addEventListener("click", (function(_this) {
            return function(e) {
              var $form, errors, ref;
              if ($('[data-checkout2]').length > 0) {
                $form = $(e.currentTarget).parents('form:first');
                errors = checkForm($form);
                if (errors.length > 0) {
                  e.stopPropagation();
                  e.stopImmediatePropagation();
                  e.preventDefault();
                  return false;
                }
              }
              if (window.run_order_creation === '1') {
                e.stopPropagation();
                e.stopImmediatePropagation();
                e.preventDefault();
                return false;
              }
              if ((ref = _this.order.delivery) != null ? ref.prevent_submit : void 0) {
                e.stopPropagation();
                e.stopImmediatePropagation();
                e.preventDefault();
                $(_this.order.delivery.html_id).triggerCustom('submitPrevented:insales:checkout');
                return false;
              }
              window.run_order_creation = '1';
              return true;
            };
          })(this), true);
        }
        $(document).on('submitPrevented:insales:checkout', (function(_this) {
          return function(e) {
            return $(window).scrollTop($('.delivery_variants').offset().top);
          };
        })(this));
        $(document).on('loaded:insales:order', (function(_this) {
          return function(e, order) {
            var ref;
            order || (order = (ref = e.originalEvent) != null ? ref.detail : void 0);
            if (_this.order.delivery) {
              order.delivery = _this.order.delivery;
            }
            if (_this.order.payment) {
              order.payment = _this.order.payment;
            }
            if (_this.order.client) {
              order.client = _this.order.client;
            }
            if (_this.order.recipient) {
              order.recipient = _this.order.recipient;
            } else {
              order.recipient = {
                name: order.shipping_address.name,
                phone: order.shipping_address.phone,
                email: order.client.email
              };
              if ($('#shipping_address_surname').length || $('#client_surname').length) {
                order.recipient.surname = order.shipping_address.surname;
              }
              if ($('#shipping_address_middlename').length || $('#client_middlename').length) {
                order.recipient.middlename = order.shipping_address.middlename;
              }
            }
            _this.order = order;
            return $(document).triggerCustom('inited:insales:checkout:order', _this.order);
          };
        })(this));
        $(document).on('updated:insales:recipient', (function(_this) {
          return function(e, recipient) {
            var f, i, j, len, len1, ref, ref1, ref2;
            recipient || (recipient = (ref = e.originalEvent) != null ? ref.detail : void 0);
            _this.order.recipient = recipient;
            ref1 = ['name', 'surname', 'middlename', 'phone'];
            for (i = 0, len = ref1.length; i < len; i++) {
              f = ref1[i];
              _this.order.shipping_address[f] = recipient[f];
            }
            if (!_this.order.client.registered) {
              ref2 = ['name', 'surname', 'middlename', 'phone', 'email'];
              for (j = 0, len1 = ref2.length; j < len1; j++) {
                f = ref2[j];
                _this.order.client[f] = recipient[f];
              }
            }
            return $(e.target).triggerCustom('updated:insales:checkout:recipient', _this.order);
          };
        })(this));
        $(document).on('updated:insales:address', (function(_this) {
          return function(e, address) {
            var ref;
            address || (address = (ref = e.originalEvent) != null ? ref.detail : void 0);
            if (address.country != null) {
              _this.order.shipping_address.country = address.country;
            }
            if (address.region != null) {
              _this.order.shipping_address.region = address.region;
            }
            if (address.city != null) {
              _this.order.shipping_address.city = address.city;
            }
            if (address.address != null) {
              _this.order.shipping_address.address = address.address;
            }
            return $(e.target).triggerCustom('updated:insales:checkout:address', _this.order);
          };
        })(this));
        $(document).on('inited:insales:deliveries', (function(_this) {
          return function(e, data) {
            var ref;
            data || (data = (ref = e.originalEvent) != null ? ref.detail : void 0);
            return $(document).triggerCustom('inited:insales:checkout:deliveries', {
              order: _this.order,
              deliveries: data
            });
          };
        })(this));
        $(document).on('inited:insales:payments', (function(_this) {
          return function(e, data) {
            var ref;
            data || (data = (ref = e.originalEvent) != null ? ref.detail : void 0);
            return $(document).triggerCustom('inited:insales:checkout:payments', {
              order: _this.order,
              payments: data
            });
          };
        })(this));
        $(document).on('selected:insales:delivery', (function(_this) {
          return function(e, delivery) {
            var ref;
            _this.order.delivery = delivery || ((ref = e.originalEvent) != null ? ref.detail : void 0);
            return $(e.target).triggerCustom('selected:insales:checkout:delivery', _this.order);
          };
        })(this));
        $(document).on('unselected:insales:delivery', (function(_this) {
          return function(e, delivery) {
            var ref;
            _this.order.delivery = delivery || ((ref = e.originalEvent) != null ? ref.detail : void 0);
            return $(e.target).triggerCustom('unselected:insales:checkout:delivery', _this.order);
          };
        })(this));
        $(document).on('updated:insales:delivery', (function(_this) {
          return function(e, delivery) {
            var ref;
            delivery || (delivery = (ref = e.originalEvent) != null ? ref.detail : void 0);
            if (delivery.selected) {
              _this.order.delivery = delivery;
              return $(e.target).triggerCustom('updated:insales:checkout:delivery', _this.order);
            }
          };
        })(this));
        $(document).on('selected:insales:payment', (function(_this) {
          return function(e, payment) {
            var ref;
            _this.order.payment = payment || ((ref = e.originalEvent) != null ? ref.detail : void 0);
            return $(e.target).triggerCustom('selected:insales:checkout:payment', _this.order);
          };
        })(this));
        $(document).on('updated:insales:payment', (function(_this) {
          return function(e, payment) {
            var ref;
            payment || (payment = (ref = e.originalEvent) != null ? ref.detail : void 0);
            if (payment.selected) {
              _this.order.payment = payment;
              return $(e.target).triggerCustom('updated:insales:checkout:payment', _this.order);
            }
          };
        })(this));
        return $(document).on('updated:insales:checkout:bonus_points', function() {
          return that.updateNewOrder(function(data) {
            $(document).trigger('loaded:insales:order', [data]);
            $(document).triggerCustom('changed:insales:discounts');
            return CheckoutView.drawTotalPrice(CheckoutView.calculateTotalPrice(that.order));
          });
        });
      },
      updateNewOrder: function(callback) {
        return $.post('/new_order/update', $('#order_form').serialize(), callback);
      }
    };
    $(function() {
      var $nested;
      $nested = $('.co-input--nested').find('.js-input-field');
      $nested.on('focus', function(e) {
        var $field, $input;
        $field = $(this);
        $input = $field.parents('.co-input:first');
        return $input.removeClass('co-input--empty_nested');
      }).on('blur', function(e) {
        var $field, $input;
        $field = $(this);
        $input = $field.parents('.co-input:first');
        if ($field.val() === '' && !$field.is('select')) {
          return $input.addClass('co-input--empty_nested');
        }
      }).trigger('blur');
      BonusPoints.init();
      CheckoutView.init();
      Checkout.init();
      return Discounts.init();
    });
    return {
      Checkout: Checkout,
      CheckoutView: CheckoutView,
      set_message: set_message,
      add_commas: add_commas,
      get_numeric: get_numeric,
      no_delivery: no_delivery
    };
  });

}).call(this);
(function() {
  define('shop/checkout/views/address', ['jquery'], function($) {
    var AddressView;
    AddressView = {
      init: function() {
        console.log('AddressView: init');
        $(document).on('updated:insales:address', (function(_this) {
          return function(e, address) {
            var ref;
            address || (address = (ref = e.originalEvent) != null ? ref.detail : void 0);
            $('#shipping_address_country').val(address.country);
            $('#shipping_address_state').val(address.region);
            $('#shipping_address_city').val(address.city);
            return $('#shipping_address_address').val(address.address);
          };
        })(this));
        if ($('#shipping_address_zip').prop('defaultValue') !== '') {
          return $(document).one('change typeahead:selected typeahead:autocompleted', '#shipping_address_country, #shipping_address_city, #shipping_address_state', (function(_this) {
            return function(e) {
              return $('#shipping_address_zip').val('');
            };
          })(this));
        }
      }
    };
    return AddressView;
  });

}).call(this);
(function() {
  define('shop/checkout/address', ['jquery', 'shop/checkout/views/address'], function($, AddressView) {
    var CheckoutAddress;
    CheckoutAddress = {
      address: null,
      init: function() {
        console.log('CheckoutAddress: init');
        $(document).on('inited:insales:checkout:order', (function(_this) {
          return function(e, order) {
            var ref;
            order || (order = (ref = e.originalEvent) != null ? ref.detail : void 0);
            _this.address || (_this.address = order.shipping_address);
            _this.address.location_valid = order.shipping_address.location_valid;
            if (_this.address.location_valid || $('#shipping_address_full_locality_name').val() === '') {
              return $('#delivery-location-not-valid').hide();
            } else {
              return $('#delivery-location-not-valid').show();
            }
          };
        })(this));
        return $(document).on('update:insales:address', (function(_this) {
          return function(e, address) {
            var ref;
            address || (address = (ref = e.originalEvent) != null ? ref.detail : void 0);
            if (address.country != null) {
              _this.address.country = address.country;
            }
            if (address.region != null) {
              _this.address.region = address.region;
            }
            if (address.city != null) {
              _this.address.city = address.city;
            }
            if (address.address != null) {
              _this.address.address = address.address;
            }
            return $(document).triggerCustom('updated:insales:address', _this.address);
          };
        })(this));
      }
    };
    $(function() {
      CheckoutAddress.init();
      return AddressView.init();
    });
    return {
      CheckoutAddress: CheckoutAddress,
      AddressView: AddressView
    };
  });

}).call(this);
(function() {
  define('shop/checkout/views/recipient', ['jquery'], function($) {
    var RecipientView;
    RecipientView = {
      init: function() {
        console.log('RecipientView: init');
        return $(document).on('updated:insales:recipient', function(e, recipient) {
          var ref;
          recipient || (recipient = (ref = e.originalEvent) != null ? ref.detail : void 0);
          $('#shipping_address_phone').val(recipient.phone);
          $('#shipping_address_name').val(recipient.name);
          $('#client_phone').val(recipient.phone);
          $('#client_name').val(recipient.name);
          $('#client_surname').val(recipient.surname);
          $('#client_middlename').val(recipient.middlename);
          return $('#client_email').val(recipient.email);
        });
      }
    };
    return RecipientView;
  });

}).call(this);
(function() {
  define('shop/checkout/recipient', ['jquery', 'shop/checkout/views/recipient'], function($, RecipientView) {
    var CheckoutRecipient;
    CheckoutRecipient = {
      recipient: null,
      init: function() {
        console.log('CheckoutRecipient: init');
        $(document).on('inited:insales:checkout:order', (function(_this) {
          return function(e, order) {
            var ref;
            order || (order = (ref = e.originalEvent) != null ? ref.detail : void 0);
            return _this.recipient || (_this.recipient = order.recipient);
          };
        })(this));
        $(document).on('change', '#shipping_address_phone', (function(_this) {
          return function(e) {
            if (!_this.recipient) {
              return true;
            }
            _this.recipient.phone = $(e.target).val();
            return $(document).triggerCustom('updated:insales:recipient', _this.recipient);
          };
        })(this));
        $(document).on('change', '#shipping_address_name', (function(_this) {
          return function(e) {
            if (!_this.recipient) {
              return true;
            }
            _this.recipient.name = $(e.target).val();
            return $(document).triggerCustom('updated:insales:recipient', _this.recipient);
          };
        })(this));
        $(document).on('change', '#shipping_address_surname', (function(_this) {
          return function(e) {
            if (!_this.recipient) {
              return true;
            }
            _this.recipient.surname = $(e.target).val();
            return $(document).triggerCustom('updated:insales:recipient', _this.recipient);
          };
        })(this));
        $(document).on('change', '#shipping_address_middlename', (function(_this) {
          return function(e) {
            if (!_this.recipient) {
              return true;
            }
            _this.recipient.middlename = $(e.target).val();
            return $(document).triggerCustom('updated:insales:recipient', _this.recipient);
          };
        })(this));
        $(document).on('change', '#client_name', (function(_this) {
          return function(e) {
            if (!_this.recipient) {
              return true;
            }
            _this.recipient.name = $(e.target).val();
            return $(document).triggerCustom('updated:insales:recipient', _this.recipient);
          };
        })(this));
        $(document).on('change', '#client_surname', (function(_this) {
          return function(e) {
            if (!_this.recipient) {
              return true;
            }
            _this.recipient.surname = $(e.target).val();
            return $(document).triggerCustom('updated:insales:recipient', _this.recipient);
          };
        })(this));
        $(document).on('change', '#client_middlename', (function(_this) {
          return function(e) {
            if (!_this.recipient) {
              return true;
            }
            _this.recipient.middlename = $(e.target).val();
            return $(document).triggerCustom('updated:insales:recipient', _this.recipient);
          };
        })(this));
        $(document).on('change', '#client_phone', (function(_this) {
          return function(e) {
            if (!_this.recipient) {
              return true;
            }
            _this.recipient.phone = $(e.target).val();
            return $(document).triggerCustom('updated:insales:recipient', _this.recipient);
          };
        })(this));
        $(document).on('change', '#client_email', (function(_this) {
          return function(e) {
            if (!_this.recipient) {
              return true;
            }
            _this.recipient.email = $(e.target).val();
            return $(document).triggerCustom('updated:insales:recipient', _this.recipient);
          };
        })(this));
        return $(document).on('update:insales:recipient', (function(_this) {
          return function(e, recipient) {
            var ref;
            recipient || (recipient = (ref = e.originalEvent) != null ? ref.detail : void 0);
            if (recipient.name != null) {
              _this.recipient.name = recipient.name;
            }
            if (recipient.surname != null) {
              _this.recipient.surname = recipient.surname;
            }
            if (recipient.middlename != null) {
              _this.recipient.middlename = recipient.middlename;
            }
            if (recipient.phone != null) {
              _this.recipient.phone = recipient.phone;
            }
            if (recipient.email != null) {
              _this.recipient.email = recipient.email;
            }
            return $(document).triggerCustom('updated:insales:recipient', _this.recipient);
          };
        })(this));
      }
    };
    $(function() {
      RecipientView.init();
      return CheckoutRecipient.init();
    });
    return {
      RecipientView: RecipientView,
      CheckoutRecipient: CheckoutRecipient
    };
  });

}).call(this);
(function() {
  define('shop/checkout/views/delivery', ['jquery', 'i18n'], function($, I18n) {
    var DeliveryView;
    DeliveryView = {
      init: function() {
        console.log('DeliveryView: init');
        $(document).on('updated:insales:delivery', (function(_this) {
          return function(e, delivery) {
            var ref;
            delivery || (delivery = (ref = e.originalEvent) != null ? ref.detail : void 0);
            return _this.draw($(e.target), delivery);
          };
        })(this));
        $(document).on('error:insales:delivery', (function(_this) {
          return function(e, error) {
            var ref;
            error || (error = (ref = e.originalEvent) != null ? ref.detail : void 0);
            return _this.drawError($(e.target), error);
          };
        })(this));
        $(document).on('calculating:insales:delivery', (function(_this) {
          return function(e) {
            return _this.drawLoading($(e.target));
          };
        })(this));
        $(document).on('changed:insales:deliveries', (function(_this) {
          return function(e, deliveries) {
            var ref;
            deliveries || (deliveries = (ref = e.originalEvent) != null ? ref.detail : void 0);
            _this.drawInputs(deliveries);
            return _this.drawCustomFields(deliveries);
          };
        })(this));
        return $(document).on('hide:insales:delivery error:insales:delivery update:insales:delivery disable:insales:delivery', (function(_this) {
          return function(e) {
            return $($(e.target).attr('rel')).siblings('.loader').hide();
          };
        })(this));
      },
      draw: function($target, delivery) {
        var $parentTr, $price, delivery_details_link, priceRangeArray, priceRangeStr, ref, ref1, ref2, ref3, ref4;
        $price = $($target.attr('rel'));
        delivery_details_link = '';
        if (delivery.calculation_details) {
          delivery_details_link = '<a href="' + (delivery.calculation_details || '') + '" target="_blank">' + I18n.t('shop.order_registration.delivery_details') + '</a>';
        }
        $parentTr = $target.closest('.co-input-wrapper');
        $parentTr.find('[id^=delivery_error_]').hide();
        if (delivery.description_html) {
          $parentTr.find("#delivery_description_" + delivery.id).html(delivery.description_html);
        }
        $parentTr.find("#delivery_interval_" + delivery.id).html(((ref = delivery.delivery_info) != null ? (ref1 = ref.delivery_interval) != null ? ref1.description : void 0 : void 0) || '');
        $parentTr.find("#delivery_details_" + delivery.id).html(delivery_details_link);
        if ($parentTr.find('.co-pick_up-selected_point').length !== 0) {
          this.drawOutletInfo((delivery != null ? (ref2 = delivery.delivery_info) != null ? ref2.outlet : void 0 : void 0) || {});
        }
        if ($(delivery.html_id).data('delivery-pickup') && !((ref3 = delivery.delivery_info) != null ? (ref4 = ref3.outlet) != null ? ref4.address : void 0 : void 0)) {
          $price.attr('data-price', null).html('');
          if (delivery.price_range && (delivery.price_range.min || delivery.price_range.max)) {
            priceRangeArray = [];
            if (delivery.price_range.min) {
              priceRangeArray.push(InSales.formatMoney(delivery.price_range.min));
            }
            if (delivery.price_range.max) {
              priceRangeArray.push(InSales.formatMoney(delivery.price_range.max));
            }
            priceRangeStr = priceRangeArray.join(' - ');
            if (delivery.price_range.min === delivery.price_range.max) {
              priceRangeStr = "+ " + (InSales.formatMoney(delivery.price_range.max));
            }
            $parentTr.find("#price_range_" + delivery.id).show().html(priceRangeStr);
          }
        } else {
          $parentTr.find("#price_range_" + delivery.id).hide();
          $price.attr('data-price', delivery.price).html('+ ' + InSales.formatMoney(delivery.price));
        }
        return $price.show();
      },
      drawOutletInfo: function(outlet) {
        if (outlet != null ? outlet.address : void 0) {
          $('.co-pick_up-selected_point').show();
        } else {
          $('.co-pick_up-selected_point').hide();
        }
        $('.co-pick_up-selected_point_title').html(outlet.title || '');
        return $('.co-pick_up-selected_point_address').html(outlet.address || '');
      },
      drawLoading: function($target) {
        var $price;
        $price = $($target.attr('rel'));
        $price.hide();
        if (!$price.siblings('.loader').show().length) {
          return $price.parent().append('<img class="loader" src="/served_assets/ajax_indicator.gif">');
        }
      },
      drawError: (function(_this) {
        return function($target, error) {
          var $errorPlaceholder;
          $errorPlaceholder = $target.closest('.co-input-wrapper').find('[id^=delivery_error_]');
          return $errorPlaceholder.html(error).show();
        };
      })(this),
      drawCustomFields: function(deliveries) {
        var $field, k, ref, results, v;
        ref = this.uniqFieldsValues(deliveries);
        results = [];
        for (k in ref) {
          v = ref[k];
          $field = $("div#checkout_result_field_" + v.field_id);
          if (!$field.length) {
            continue;
          }
          if (!v.selected) {
            $field.hide();
            continue;
          }
          if (!v.human_value && !v.value) {
            $field.html('').hide();
            continue;
          }
          $field.find('.field-content').html(v.human_value || v.value);
          results.push($field.show());
        }
        return results;
      },
      drawInputs: function(deliveries) {
        var $delete, $fieldKey, $fieldValue, $target, k, ref, results, selected, v, x;
        $target = $('#hidden-data');
        if (!$('#hidden-data').length) {
          $target = $('<div id="hidden-data" style="display: none"></div>');
          $('.delivery_variants').before($target);
        }
        $target.html('');
        selected = null;
        for (k in deliveries) {
          v = deliveries[k];
          if (v.selected) {
            selected = v;
            break;
          }
        }
        $target.append($('<input id="default_delivery_variant_id" type="hidden" name="order[delivery_variant_id]" value />'));
        if (selected && selected.is_external) {
          if (selected.api_version !== 'v2') {
            $target.append($('<input id="delivery_price_' + selected.id + '" type="hidden" name="order[delivery_price]"/>').val(selected.price));
          }
          if (selected.description) {
            $target.append($('<input id="delivery_description_' + selected.id + '" type="hidden" name="order[delivery_description]"/>').val(selected.description));
          }
          $target.append($('<input id="delivery_info_' + selected.id + '" type="hidden" name="order[delivery_info_attributes]"/>').val(JSON.stringify(selected.delivery_info)));
        }
        x = 0;
        ref = this.uniqFieldsValues(deliveries);
        results = [];
        for (k in ref) {
          v = ref[k];
          $fieldKey = $('<input id="order_field_id_' + x + '" type="hidden" name="order[fields_values_attributes][' + x + '][field_id]"/>').val(v.field_id);
          if (v.handle) {
            $fieldKey = $('<input id="order_field_id_' + x + '" type="hidden" name="order[fields_values_attributes][' + x + '][handle]"/>').val(v.handle);
          }
          $target.append($fieldKey);
          if (!v.selected) {
            $delete = $('<input id="order_field_value_' + x + '" type="hidden" name="order[fields_values_attributes][' + x + '][_destroy]"/>').val('1');
            $target.append($delete);
            x += 1;
            continue;
          }
          $fieldValue = $('<input id="order_field_value_' + x + '" type="hidden" name="order[fields_values_attributes][' + x + '][value]"/>').val(v.value);
          $target.append($fieldValue);
          results.push(x += 1);
        }
        return results;
      },
      uniqFieldsValues: function(deliveries) {
        var currentKey, delivery, k, ref, uniqFieldsValues, v;
        uniqFieldsValues = {};
        for (k in deliveries) {
          delivery = deliveries[k];
          ref = delivery.fields_values;
          for (k in ref) {
            v = ref[k];
            currentKey = v.field_id || v.handle;
            if (!currentKey) {
              continue;
            }
            if (delivery.selected) {
              v = $.extend({}, v, {
                selected: true
              });
            }
            if (uniqFieldsValues[currentKey] && uniqFieldsValues[currentKey].selected) {
              continue;
            }
            uniqFieldsValues[currentKey] = v;
          }
        }
        return uniqFieldsValues;
      }
    };
    return DeliveryView;
  });

}).call(this);
(function() {
  define('shop/checkout/delivery', ['jquery', 'shop/public/insales', 'shop/checkout/views/delivery'], function($, InSales, DeliveryView) {
    var CheckoutDelivery, Delivery;
    Delivery = (function() {
      function Delivery(id, price, position, isExternal, externalUrl, customerPickup, deliveryInfo, apiVersion) {
        this.id = parseInt(id);
        this.available = false;
        this.active = false;
        this.htmlId = '#order_delivery_variant_id_' + this.id;
        this.selected = false;
        this.description = null;
        this.descriptionHtml = null;
        this.isExternal = isExternal;
        this.externalUrl = externalUrl;
        this.externalData = {};
        this.apiVersion = apiVersion;
        this.preventSubmit = false;
        this.position = parseFloat(position);
        this.customerPickup = customerPickup;
        this.calculationDetails = null;
        this.hasErrors = false;
        this.calculating = false;
        this.priceRange = {};
        this.setDeliveryInfo(deliveryInfo);
        this.setPrice(price);
      }

      Delivery.prototype.setFieldsValues = function(fieldsValues) {
        return this.deliveryInfo.fields_values = fieldsValues || [];
      };

      Delivery.prototype.setPrice = function(price) {
        return this.price = price ? parseFloat(price) : 0.0;
      };

      Delivery.prototype.setDescription = function(description) {
        return this.description = description;
      };

      Delivery.prototype.setDescriptionHtml = function(descriptionHtml) {
        return this.descriptionHtml = descriptionHtml;
      };

      Delivery.prototype.setExternalData = function(data) {
        return this.externalData = data || {};
      };

      Delivery.prototype.setDeliveryInterval = function(deliveryInterval) {
        return this.deliveryInfo.delivery_interval = deliveryInterval || {};
      };

      Delivery.prototype.setDeliveryInfo = function(deliveryInfo) {
        return this.deliveryInfo = $.extend(this.deliveryInfo || {}, {
          delivery_interval: {},
          outlet: {},
          fields_values: []
        }, deliveryInfo || {});
      };

      Delivery.prototype.control = function() {
        return $(this.htmlId);
      };

      Delivery.prototype.toExternal = function() {
        this.isExternal = true;
        return this;
      };

      return Delivery;

    })();
    CheckoutDelivery = {
      deliveries: {},
      deliveriesInited: false,
      currentId: null,
      init: function() {
        console.log('CheckoutDelivery: init');
        $.each($('[data-delivery-variants]').data('delivery-variants') || [], (function(_this) {
          return function(k, v) {
            var d;
            d = new Delivery(v.id, v.price, v.position, v.is_external, v.external_url, v.customer_pickup, v.delivery_info, v.api_version);
            return _this.deliveries[d.id] = d;
          };
        })(this));
        return this.bind();
      },
      bind: function() {
        var checkoutDelivery, debouncedReadyFunction;
        checkoutDelivery = this;
        debouncedReadyFunction = $.debounce(2000, false, function() {
          if (checkoutDelivery.deliveriesInited) {
            return $(document).triggerCustom('inited:insales:deliveries', checkoutDelivery.serialzedDeliveries());
          }
        });
        $(document).on('ready:insales:delivery', (function(_this) {
          return function() {
            return debouncedReadyFunction();
          };
        })(this));
        $(document).on('click select:insales:delivery', '.delivery_variants .radio_button', (function(_this) {
          return function(e, data) {
            var initClick, ref;
            if ($(e.target).closest('.co-input-wrapper').hasClass('not_available')) {
              return false;
            }
            $(e.target).attr('checked', 'checked');
            data || (data = (ref = e.originalEvent) != null ? ref.detail : void 0);
            initClick = data != null ? data.initClick : void 0;
            if (!_this.setCurrent($(e.target).data('deliveryId')) && !initClick) {
              return;
            }
            if (_this.prevSelected()) {
              console.log('unselect');
              _this.prevSelected().control().triggerCustom('unselected:insales:delivery', _this.serializeDelivery(_this.prevSelected()));
            }
            console.log('select');
            _this.current().control().triggerCustom('selected:insales:delivery', _this.serializeDelivery(_this.current()));
            return $(document).triggerCustom('changed:insales:deliveries', _this.serialzedDeliveries());
          };
        })(this));
        $(document).on('calculating:insales:delivery', (function(_this) {
          return function(e) {
            var $target, delivery;
            $target = $(e.target);
            delivery = _this.find($target.data('deliveryId'));
            return delivery != null ? delivery.calculating = true : void 0;
          };
        })(this));
        $(document).on('enable:insales:delivery', (function(_this) {
          return function(e) {
            var $target, delivery;
            $target = $(e.target);
            delivery = _this.find($target.data('deliveryId'));
            if (delivery) {
              return delivery.active = true;
            }
          };
        })(this));
        $(document).on('disable:insales:delivery', (function(_this) {
          return function(e) {
            var $target, delivery, ref;
            $target = $(e.target);
            delivery = _this.find($target.data('deliveryId'));
            if (delivery) {
              delivery.active = false;
            }
            if (delivery.selected && _this.deliveriesInited) {
              return (ref = _this.firstAvailable()) != null ? ref.control().click() : void 0;
            }
          };
        })(this));
        $(document).on('loading:insales:deliveries', (function(_this) {
          return function() {
            var k, ref, results, v;
            ref = _this.deliveries;
            results = [];
            for (k in ref) {
              v = ref[k];
              v.available = false;
              v.active = false;
              v.selected = false;
              results.push(v.preventSubmit = false);
            }
            return results;
          };
        })(this));
        $(document).on('loaded:insales:deliveries', (function(_this) {
          return function(e, loadedDeliveries) {
            var changed, currentId, delivery, k, ref, ref1, ref2, ref3, ref4, v;
            loadedDeliveries || (loadedDeliveries = (ref = e.originalEvent) != null ? ref.detail : void 0);
            _this.deliveriesInited = false;
            currentId = null;
            for (k in loadedDeliveries) {
              v = loadedDeliveries[k];
              delivery = _this.find(v.id);
              if (!delivery) {
                continue;
              }
              delivery.available = true;
              if (v.selected) {
                currentId = delivery.id;
              }
              delivery.control().triggerCustom('enable:insales:delivery');
              if (!delivery.isExternal) {
                delivery.control().triggerCustom('update:insales:delivery', v);
              } else {
                delivery.control().triggerCustom('updated:insales:delivery', _this.serializeDelivery(delivery));
              }
              if (((ref1 = v.delivery_info.errors) != null ? ref1.price : void 0) || v.delivery_info.errors.length > 0) {
                delivery.hasErrors = true;
                delivery.control().triggerCustom('error:insales:delivery', v.delivery_info.errors.price || v.delivery_info.errors);
              }
            }
            currentId || (currentId = (ref2 = _this.firstAvailable()) != null ? ref2.id : void 0);
            changed = _this.setCurrent(currentId);
            $(document).triggerCustom('inited:insales:deliveries', _this.serialzedDeliveries());
            _this.deliveriesInited = true;
            if (_this.current() && (!_this.current().available || !_this.current().active)) {
              changed = _this.setCurrent((ref3 = _this.firstAvailable()) != null ? ref3.id : void 0);
            }
            ref4 = _this.deliveries;
            for (k in ref4) {
              v = ref4[k];
              if (!v.available) {
                v.control().triggerCustom('disable:insales:delivery');
              }
            }
            if (!_this.current()) {
              return;
            }
            if (!_this.current().hasErrors && !_this.current().calculating) {
              _this.current().control().triggerCustom('update:insales:delivery');
            }
            return _this.current().control().triggerCustom('click', {
              initClick: changed
            });
          };
        })(this));
        $(document).on('update:insales:delivery', (function(_this) {
          return function(e, data) {
            var delivery, ref;
            data || (data = (ref = e.originalEvent) != null ? ref.detail : void 0);
            delivery = _this.find($(e.target).data('deliveryId'));
            if (!delivery) {
              return;
            }
            data = data || {};
            _this.updateDelivery(delivery, data);
            if (data.is_external) {
              delivery.toExternal();
            }
            delivery.control().triggerCustom('updated:insales:delivery', _this.serializeDelivery(delivery));
            return $(document).triggerCustom('changed:insales:deliveries', _this.serialzedDeliveries());
          };
        })(this));
        $(document).on('preventSubmit:insales:delivery', (function(_this) {
          return function(e) {
            var delivery;
            delivery = _this.find($(e.target).data('deliveryId'));
            if (!delivery) {
              return;
            }
            delivery.preventSubmit = true;
            return delivery.control().triggerCustom('updated:insales:delivery', _this.serializeDelivery(delivery));
          };
        })(this));
        return $(document).on('allowSubmit:insales:delivery', (function(_this) {
          return function(e) {
            var delivery;
            delivery = _this.find($(e.target).data('deliveryId'));
            if (!delivery) {
              return;
            }
            delivery.preventSubmit = false;
            return delivery.control().triggerCustom('updated:insales:delivery', _this.serializeDelivery(delivery));
          };
        })(this));
      },
      serialzedDeliveries: function() {
        var k, ref, serialzedDeliveries, v;
        serialzedDeliveries = {};
        ref = this.deliveries;
        for (k in ref) {
          v = ref[k];
          serialzedDeliveries[k] = this.serializeDelivery(v);
        }
        return serialzedDeliveries;
      },
      serializeDelivery: function(delivery) {
        return {
          id: delivery.id,
          html_id: delivery.htmlId,
          available: delivery.available,
          active: delivery.active,
          price: delivery.price,
          description: delivery.description,
          description_html: delivery.descriptionHtml,
          fields_values: delivery.deliveryInfo.fields_values,
          selected: delivery.selected,
          customer_pickup: delivery.customerPickup,
          is_external: delivery.isExternal,
          external_url: delivery.externalUrl,
          external_data: delivery.externalData,
          api_version: delivery.apiVersion,
          prevent_submit: delivery.preventSubmit,
          delivery_info: delivery.deliveryInfo,
          calculation_details: delivery.calculationDetails,
          price_range: delivery.priceRange
        };
      },
      updateDelivery: function(delivery, data) {
        var price, ref;
        if (data.price !== void 0) {
          price = data.price;
        }
        if (price === void 0) {
          price = (ref = data.delivery_info) != null ? ref.price : void 0;
        }
        delivery.calculating = false;
        if (data.description !== void 0) {
          delivery.setDescription(data.description);
        }
        if (data.description_html !== void 0) {
          delivery.setDescriptionHtml(data.description_html);
        }
        if (data.fields_values !== void 0) {
          delivery.setFieldsValues(data.fields_values);
        }
        if (data.external_data !== void 0) {
          delivery.setExternalData(data.external_data);
        }
        if (data.delivery_info !== void 0) {
          delivery.setDeliveryInfo(data.delivery_info);
        }
        if (price !== void 0) {
          delivery.setPrice(price);
        }
        if (data.delivery_interval !== void 0) {
          delivery.setDeliveryInterval(data.delivery_interval);
        }
        delivery.hasErrors = false;
        if (data.calculation_details !== void 0) {
          delivery.calculationDetails = data.calculation_details;
        }
        if (data.price_range !== void 0) {
          return delivery.priceRange = data.price_range;
        }
      },
      setCurrent: function(id) {
        var k, ref, v;
        id = parseInt(id);
        ref = this.deliveries;
        for (k in ref) {
          v = ref[k];
          v.selected = false;
        }
        if (this.currentId === id) {
          if (this.current()) {
            this.current().selected = true;
          }
          return false;
        }
        this.prevSelectedId = this.currentId;
        this.currentId = id;
        if (this.current()) {
          this.current().selected = true;
        }
        return this.current();
      },
      firstAvailable: function() {
        var firstElement, k, ref, v;
        firstElement = null;
        ref = this.deliveries;
        for (k in ref) {
          v = ref[k];
          if (!v.active || !v.available) {
            continue;
          }
          firstElement || (firstElement = v);
          if (v.position <= firstElement.position) {
            firstElement = v;
          }
        }
        return firstElement;
      },
      current: function() {
        return this.deliveries[this.currentId];
      },
      prevSelected: function() {
        return this.deliveries[this.prevSelectedId];
      },
      find: function(id) {
        id = parseInt(id);
        return this.deliveries[id];
      }
    };
    $(function() {
      DeliveryView.init();
      return CheckoutDelivery.init();
    });
    return {
      Delivery: Delivery,
      DeliveryView: DeliveryView,
      CheckoutDelivery: CheckoutDelivery
    };
  });

}).call(this);
(function() {
  define('shop/checkout_delivery_backward_compatibility', ['jquery'], function($) {
    var CheckoutDelivery, Delivery;
    Delivery = (function() {
      function Delivery(id) {
        this.id = id;
        this.fieldsValues = [];
      }

      Delivery.prototype.setFieldsValues = function(fieldsValues) {
        var newFieldsValues;
        newFieldsValues = $.map(fieldsValues, function(v) {
          return {
            field_id: v.fieldId || v.field_id,
            value: v.value
          };
        });
        this.fieldsValues = $.merge(this.fieldsValues, newFieldsValues);
        this.control().trigger('update:insales:delivery', {
          is_external: true
        });
        this.control().trigger('update:insales:delivery', {
          fields_values: this.fieldsValues
        });
        return this;
      };

      Delivery.prototype.setPrice = function(price) {
        this.control().trigger('update:insales:delivery', {
          is_external: true
        });
        this.control().trigger('update:insales:delivery', {
          price: price
        });
        return this;
      };

      Delivery.prototype.control = function() {
        return $('#order_delivery_variant_id_' + this.id);
      };

      Delivery.prototype.toExternal = function() {
        this.control().trigger('update:insales:delivery', {
          is_external: true
        });
        this.fieldsValues = [];
        return this;
      };

      return Delivery;

    })();
    CheckoutDelivery = {
      deliveries: {},
      currentId: null,
      order: null,
      init: function() {
        $(document).on('updated:insales:checkout:delivery selected:insales:checkout:delivery', (function(_this) {
          return function(e, order) {
            var ref;
            return _this.order || (_this.order = (ref = e.originalEvent) != null ? ref.detail : void 0);
          };
        })(this));
        $(document).on('updated:insales:checkout:payment selected:insales:checkout:payment', (function(_this) {
          return function(e, order) {
            var ref;
            return _this.order || (_this.order = (ref = e.originalEvent) != null ? ref.detail : void 0);
          };
        })(this));
        return $(document).on('selected:insales:delivery', (function(_this) {
          return function(e, delivery) {
            var ref;
            delivery || (delivery = (ref = e.originalEvent) != null ? ref.detail : void 0);
            return _this.currentId = delivery.id;
          };
        })(this));
      },
      current: function() {
        return this.find(this.currentId);
      },
      find: function(id) {
        var base;
        (base = this.deliveries)[id] || (base[id] = new Delivery(id));
        return this.deliveries[id];
      },
      set_total_and_delivery_price: function(price) {
        var ref;
        if ((ref = this.order.delivery) != null) {
          ref.price = price ? parseFloat(price) : 0.0;
        }
        return $(document).trigger('updated:insales:delivery', this.order.delivery);
      }
    };
    $(function() {
      return CheckoutDelivery.init();
    });
    return {
      Delivery: Delivery,
      CheckoutDelivery: CheckoutDelivery
    };
  });

}).call(this);
(function() {
  define('shop/checkout/views/payment_gateway', ['jquery'], function($) {
    var CheckoutPaymentView;
    CheckoutPaymentView = {
      init: function() {
        console.log('CheckoutPaymentView: init');
        return $(document).on('updated:insales:payment', (function(_this) {
          return function(e, payment) {
            var ref;
            payment || (payment = (ref = e.originalEvent) != null ? ref.detail : void 0);
            return _this.draw($(e.target), payment);
          };
        })(this));
      },
      draw: function($target, payment) {
        var $price, value;
        value = InSales.formatMoney(Math.abs(payment.price));
        if (payment.price > 0) {
          value = '+ ' + value;
        }
        if (payment.price < 0) {
          value = '- ' + value;
        }
        $price = $($target.attr('rel'));
        $price.attr('data-price', payment.price).html(value);
        if (!payment.price || payment.price === 0.0) {
          return $price.hide();
        }
        return $price.show();
      }
    };
    return CheckoutPaymentView;
  });

}).call(this);
(function() {
  define('shop/checkout/payment_gateway', ['jquery', 'shop/checkout/views/payment_gateway'], function($, CheckoutPaymentView) {
    var CheckoutPaymentGateway, Payment;
    Payment = (function() {
      function Payment(id, price, position, description) {
        this.id = id;
        this.price = 0.0;
        this.selected = false;
        this.active = false;
        this.available = false;
        this.margin = 0.0;
        this.position = parseFloat(position);
        this.description = description;
        this.htmlId = '#order_payment_gateway_id_' + this.id;
        this.setPrice(price);
      }

      Payment.prototype.setPrice = function(price) {
        return this.price = price ? parseFloat(price) : 0.0;
      };

      Payment.prototype.setMargin = function(margin) {
        return this.margin = margin ? parseFloat(margin) : 0.0;
      };

      Payment.prototype.setDescription = function(description) {
        return this.description = description;
      };

      Payment.prototype.control = function() {
        return $(this.htmlId);
      };

      return Payment;

    })();
    CheckoutPaymentGateway = {
      payments: {},
      paymentsInited: false,
      currentId: null,
      init: function() {
        console.log('CheckoutPaymenGateway: init');
        $.each($('[data-payment-gateways]').data('payment-gateways') || [], (function(_this) {
          return function(k, v) {
            var p;
            p = new Payment(v.id, v.price, v.position, v.description);
            return _this.payments[p.id] = p;
          };
        })(this));
        $(document).on('click', '.payment_variants .radio_button', (function(_this) {
          return function(e, data) {
            var initClick, ref;
            if ($(e.target).closest('.co-input-wrapper').hasClass('not_available')) {
              return false;
            }
            $(e.target).attr('checked', 'checked');
            data || (data = (ref = e.originalEvent) != null ? ref.detail : void 0);
            initClick = data != null ? data.initClick : void 0;
            if (!_this.setCurrent($(e.target).data('paymentId')) && !initClick) {
              return;
            }
            if (_this.prevSelected()) {
              console.log('unselected:payment');
              _this.prevSelected().control().triggerCustom('unselected:insales:payment', _this.serializePayment(_this.prevSelected()));
            }
            console.log('selected:payment');
            return _this.current().control().triggerCustom('selected:insales:payment', _this.serializePayment(_this.current()));
          };
        })(this));
        $(document).on('enable:insales:payment', (function(_this) {
          return function(e) {
            var $target, payment;
            $target = $(e.target);
            payment = _this.find($target.data('paymentId'));
            if (payment) {
              return payment.active = true;
            }
          };
        })(this));
        $(document).on('disable:insales:payment', (function(_this) {
          return function(e) {
            var $target, payment, ref;
            $target = $(e.target);
            payment = _this.find($target.data('paymentId'));
            if (payment) {
              payment.active = false;
            }
            if (payment.selected && _this.paymentsInited) {
              return (ref = _this.firstAvailable()) != null ? ref.control().click() : void 0;
            }
          };
        })(this));
        $(document).on('updated:insales:checkout:delivery selected:insales:checkout:delivery', (function(_this) {
          return function(e, order) {
            var full_price, k, payment, ref, ref1, results;
            order || (order = (ref = e.originalEvent) != null ? ref.detail : void 0);
            if (!order.delivery.selected) {
              return true;
            }
            full_price = order.items_price + order.delivery.price;
            ref1 = _this.payments;
            results = [];
            for (k in ref1) {
              payment = ref1[k];
              results.push(payment.control().triggerCustom('update:insales:payment', {
                price: full_price * (payment.margin / 100)
              }));
            }
            return results;
          };
        })(this));
        $(document).on('update:insales:payment', (function(_this) {
          return function(e, data) {
            var payment, ref;
            data || (data = (ref = e.originalEvent) != null ? ref.detail : void 0);
            payment = _this.find($(e.target).data('paymentId'));
            if (!payment) {
              return;
            }
            if (data && data.price !== void 0) {
              payment.setPrice(data.price);
            }
            if (data && data.description !== void 0) {
              payment.setDescription(data.description);
            }
            return payment.control().triggerCustom('updated:insales:payment', _this.serializePayment(payment));
          };
        })(this));
        $(document).on('loading:insales:payments', (function(_this) {
          return function() {
            var k, ref, results, v;
            ref = _this.payments;
            results = [];
            for (k in ref) {
              v = ref[k];
              v.available = false;
              v.active = false;
              results.push(v.selected = false);
            }
            return results;
          };
        })(this));
        return $(document).on('loaded:insales:payments', (function(_this) {
          return function(e, loadedPayments) {
            var changed, currentId, firstElement, k, payment, ref, ref1, ref2, ref3, v;
            loadedPayments || (loadedPayments = (ref = e.originalEvent) != null ? ref.detail : void 0);
            _this.paymentsInited = false;
            currentId = null;
            for (k in loadedPayments) {
              v = loadedPayments[k];
              payment = _this.find(v.id);
              if (!payment) {
                continue;
              }
              payment.available = true;
              payment.setMargin(v.margin);
              if (v.selected) {
                currentId = payment.id;
              }
              payment.control().triggerCustom('enable:insales:payment');
              payment.control().triggerCustom('update:insales:payment', v);
            }
            if (!currentId) {
              firstElement = null;
              ref1 = _this.payments;
              for (k in ref1) {
                v = ref1[k];
                if (!v.active || !v.available) {
                  continue;
                }
                firstElement || (firstElement = v);
                if (v.position <= firstElement.position) {
                  firstElement = v;
                }
              }
              if (firstElement) {
                currentId = firstElement.id;
              }
            }
            changed = _this.setCurrent(currentId);
            $(document).triggerCustom('inited:insales:payments', _this.serialzedPayments());
            _this.paymentsInited = true;
            if (_this.current() && (!_this.current().available || !_this.current().active)) {
              changed = _this.setCurrent((ref2 = _this.firstAvailable()) != null ? ref2.id : void 0);
            }
            ref3 = _this.payments;
            for (k in ref3) {
              v = ref3[k];
              if (!v.available) {
                v.control().triggerCustom('disable:insales:payment');
              }
            }
            if (!_this.current()) {
              return;
            }
            _this.current().control().triggerCustom('update:insales:payment');
            return _this.current().control().triggerCustom('click', {
              initClick: changed
            });
          };
        })(this));
      },
      serialzedPayments: function() {
        var k, ref, serialzedPayments, v;
        serialzedPayments = {};
        ref = this.payments;
        for (k in ref) {
          v = ref[k];
          serialzedPayments[k] = this.serializePayment(v);
        }
        return serialzedPayments;
      },
      serializePayment: function(payment) {
        return {
          id: payment.id,
          html_id: payment.htmlId,
          available: payment.available,
          active: payment.active,
          price: payment.price,
          margin: payment.margin,
          selected: payment.selected,
          description: payment.description
        };
      },
      setCurrent: function(id) {
        var k, ref, v;
        ref = this.payments;
        for (k in ref) {
          v = ref[k];
          v.selected = false;
        }
        if (this.currentId === id) {
          if (this.current()) {
            this.current().selected = true;
          }
          return false;
        }
        this.prevSelectedId = this.currentId;
        this.currentId = id;
        if (this.current()) {
          this.current().selected = true;
        }
        return this.current();
      },
      firstAvailable: function() {
        var firstAvailable, k, ref, v;
        ref = this.payments;
        for (k in ref) {
          v = ref[k];
          if (v.active && v.available) {
            firstAvailable = v;
            break;
          }
        }
        return firstAvailable;
      },
      current: function() {
        return this.payments[this.currentId];
      },
      prevSelected: function() {
        return this.payments[this.prevSelectedId];
      },
      find: function(id) {
        return this.payments[id];
      }
    };
    $(function() {
      CheckoutPaymentView.init();
      return CheckoutPaymentGateway.init();
    });
    return {
      Payment: Payment,
      CheckoutPaymentView: CheckoutPaymentView,
      CheckoutPaymentGateway: CheckoutPaymentGateway
    };
  });

}).call(this);
(function() {
  define('shop/checkout/discounts', ['jquery'], function($) {
    var Discounts;
    Discounts = {
      init: function() {
        var that;
        console.log('Discounts: init');
        that = this;
        return $(document).on('loaded:insales:order', function(e, order) {
          var ref;
          order || (order = (ref = e.originalEvent) != null ? ref.detail : void 0);
          return that.update_subtotals_from_order(order);
        });
      },
      update_subtotals_from_order: function(order) {
        var discount, discounts_block, i, len, new_subtotals, ref;
        discounts_block = $('#discounts-block');
        new_subtotals = [];
        ref = order.discounts;
        for (i = 0, len = ref.length; i < len; i++) {
          discount = ref[i];
          new_subtotals.push(this.new_subtotal_element(discount));
        }
        return discounts_block.html(new_subtotals);
      },
      new_subtotal_element: function(discount) {
        var amount, description, element;
        description = discount.description;
        amount = "- " + (InSales.formatMoney(discount.amount));
        element = $('#discount-subtotal-sample').clone();
        element.removeAttr('id');
        element.children('.discount-subtotal-description').html(description);
        element.children('.discount-subtotal-amount').html(amount);
        return element;
      }
    };
    return Discounts;
  });

}).call(this);
(function() {
  define('shop/external_delivery', ['jquery'], function($) {
    var ExternalDelivery, draw_external_price, external_deliveries_cache;
    external_deliveries_cache = {};
    draw_external_price = function(id, data) {
      return $("#order_delivery_variant_id_" + id).triggerCustom('calculated:insales:external:delivery', data);
    };
    ExternalDelivery = {
      queries: {},
      ajaxRequests: {},
      cache: {},
      init: function() {
        $(document).on('inited:insales:checkout:deliveries', (function(_this) {
          return function(e, data) {
            data || (data = e.originalEvent.detail);
            return $.each(data.deliveries, function(k, v) {
              var $target;
              $target = $(v.html_id);
              if (v.external_url && v.available && v.api_version !== 'v2') {
                $target.triggerCustom('calculating:insales:delivery');
                return _this.calc($target, {
                  order: data.order,
                  delivery: v
                });
              }
            });
          };
        })(this));
        return $(document).on('calculated:insales:external:delivery', (function(_this) {
          return function(e, data) {
            data || (data = e.originalEvent.detail);
            return _this.updateDelivery($(e.target), data);
          };
        })(this));
      },
      calc: function($target, data) {
        var base, name;
        if ((base = this.queries)[name = $target.data('deliveryId')] == null) {
          base[name] = $.debounce(1000, false, this.load);
        }
        return this.queries[$target.data('deliveryId')].call(this, $target, data);
      },
      updateDelivery: function($target, data) {
        if (!data.error && typeof data.delivery_price === 'undefined') {
          return true;
        }
        if (data.error) {
          if (data.error === 'Current carrier is not available!') {
            if (typeof window.disable_element === 'function') {
              return $target.triggerCustom('disable:insales:delivery');
            } else {
              $target.triggerCustom('hide:insales:delivery');
              return $target.triggerCustom('disable:insales:delivery');
            }
          } else if (data.error === 'Fail, not all data sent!') {
            $target.triggerCustom('update:insales:delivery', {
              price: 0
            });
            return $target.triggerCustom('error:insales:delivery', 'Указаны не все данные, убедитесь, что вы указали регион, город и индекс');
          } else {
            $target.triggerCustom('update:insales:delivery', {
              price: data.delivery_price || 0
            });
            return $target.triggerCustom('error:insales:delivery', data.error);
          }
        } else {
          if (typeof window.disable_element === 'function') {
            $target.triggerCustom('enable:insales:delivery');
          } else {
            $target.triggerCustom('enable:insales:delivery');
            $target.triggerCustom('show:insales:delivery');
          }
          return $target.triggerCustom('update:insales:delivery', {
            price: data.delivery_price
          });
        }
      },
      load: function($target, data) {
        var base, cacheKey, externalParams, id;
        id = data.delivery.id;
        externalParams = {
          price: data.order.items_price,
          weight: data.order.total_weight,
          region: data.order.shipping_address.region,
          city: data.order.shipping_address.city,
          zip: data.order.shipping_address.zip || 0,
          location: data.order.shipping_address.location
        };
        $.each($target.data() || {}, function(k, v) {
          if (k.match(/^external/)) {
            return externalParams[k] = v;
          }
        });
        cacheKey = $.param(externalParams);
        if ((base = this.cache)[id] == null) {
          base[id] = {};
        }
        if (this.cache[id][cacheKey] && !$.isEmptyObject(this.cache[id][cacheKey])) {
          return this.updateDelivery($target, this.cache[id][cacheKey]);
        }
        if (this.ajaxRequests[data.delivery.id] && this.ajaxRequests[data.delivery.id].readyState !== 4) {
          this.ajaxRequests[data.delivery.id].abort();
        }
        return this.ajaxRequests[id] = $.ajax({
          url: data.delivery.external_url,
          type: 'GET',
          dataType: 'jsonp',
          data: externalParams,
          success: (function(_this) {
            return function(data) {
              _this.cache[id][cacheKey] = data;
              return _this.updateDelivery($target, data);
            };
          })(this)
        });
      }
    };
    $(function() {
      return ExternalDelivery.init();
    });
    return {
      ExternalDelivery: ExternalDelivery,
      external_deliveries_cache: external_deliveries_cache,
      draw_external_price: draw_external_price
    };
  });

}).call(this);
(function() {
  define('shop/external_delivery_v2', ['jquery'], function($) {
    var ExternalDeliveryV2;
    ExternalDeliveryV2 = {
      queries: {},
      ajaxRequests: {},
      cache: {},
      deliveries: {},
      init: function() {
        $(document).on('inited:insales:checkout:deliveries', (function(_this) {
          return function(e, data) {
            data || (data = e.originalEvent.detail);
            return $.each(data.deliveries, function(k, v) {
              var $target;
              $target = $(v.html_id);
              _this.deliveries[v.id] = v;
              if (v.external_url && v.available && v.api_version === 'v2') {
                $target.triggerCustom('preventSubmit:insales:delivery');
                $target.triggerCustom('calculating:insales:delivery');
                return _this.calc($target, {
                  order: data.order,
                  delivery_id: v.id
                });
              }
            });
          };
        })(this));
        return $(document).on('click', '[data-delivery-tariff]', (function(_this) {
          return function(e) {
            var data;
            data = $(e.currentTarget).data('delivery-tariff');
            return _this.updateDelivery(data.delivery, data.tariff);
          };
        })(this));
      },
      calc: function($target, data) {
        var base, name;
        if ((base = this.queries)[name = $target.data('deliveryId')] == null) {
          base[name] = $.debounce(1000, false, this.load);
        }
        return this.queries[$target.data('deliveryId')].call(this, $target, data);
      },
      newDeliveryData: function(delivery_id, tariff) {
        tariff.delivery_variant_id = delivery_id;
        return {
          price: tariff.price || 0,
          delivery_info: tariff
        };
      },
      updateDelivery: function(delivery, tariff) {
        $(delivery.html_id).triggerCustom('update:insales:delivery', this.newDeliveryData(delivery.id, tariff));
        $(delivery.html_id).triggerCustom('select:insales:delivery');
        $(delivery.html_id).triggerCustom('allowSubmit:insales:delivery');
        if (tariff.errors && tariff.errors.length !== 0) {
          $(delivery.html_id).triggerCustom('preventSubmit:insales:delivery');
          return $(delivery.html_id).triggerCustom('error:insales:delivery', tariff.errors);
        }
      },
      drawDelivery: function($target, data, delivery_id) {
        var $template, d, delivery, i, j, len, len1, price, ref, tariff_id, tariffsBodySelector, tariffsWrapper, tariffsWrapperSelector, title;
        delivery = this.deliveries[delivery_id];
        tariffsWrapperSelector = "[data-delivery-tariffs-" + delivery.id + "]";
        tariffsBodySelector = "[data-delivery-tariffs-body-" + delivery.id + "]";
        data || (data = []);
        if (!$.isArray(data)) {
          data = [data];
        }
        for (i = 0, len = data.length; i < len; i++) {
          d = data[i];
          d.errors || (d.errors = []);
          d.warnings || (d.warnings = []);
          if (typeof d.available === 'undefined') {
            d.available = true;
          }
          if (d.errors.length === 0 && d.warnings.length === 0 && typeof d.price === 'undefined') {
            d.available = false;
          }
        }
        $target.triggerCustom('hide:insales:delivery');
        if (data.some(function(d, index, array) {
          return d.available;
        })) {
          if (typeof window.enable_element === 'function') {
            $target.triggerCustom('enable:insales:delivery');
          } else {
            $target.triggerCustom('enable:insales:delivery');
            $target.triggerCustom('show:insales:delivery');
          }
        } else {
          $(tariffsBodySelector).html('');
          $target.triggerCustom('update:insales:delivery', {
            price: 0
          });
          if (typeof window.disable_element === 'function') {
            $target.triggerCustom('disable:insales:delivery');
          } else {
            $target.triggerCustom('hide:insales:delivery');
            $target.triggerCustom('disable:insales:delivery');
          }
          return;
        }
        if ($target.closest('.co-input-wrapper').next(tariffsWrapperSelector).length === 0) {
          tariffsWrapper = "<div data-delivery-tariffs-" + delivery.id + "=true data-delivery-tariffs-body-" + delivery.id + "=true></div>";
          if (!$('[data-checkout2]').data('checkout2')) {
            tariffsWrapper = "<tr data-delivery-tariffs-" + delivery.id + "=true><td colspan=3 style='width: 100%'><table data-delivery-tariffs-body-" + delivery.id + "=true style='width: 100%'></table></td></tr>";
          }
          $target.closest('.co-input-wrapper').after(tariffsWrapper);
        }
        $(tariffsBodySelector).html('');
        for (j = 0, len1 = data.length; j < len1; j++) {
          d = data[j];
          tariff_id = d.tariff_id || ("none_" + delivery.id);
          title = d.title || $("#delivery_title_" + delivery.id);
          price = InSales.formatMoney(d.price || 0);
          $template = $target.closest('.co-input-wrapper').clone();
          $template.css('display', "");
          $template.find('input').attr('id', "tariff_" + tariff_id).attr('data-delivery-tariff', true).prop("checked", false);
          $template.find('[data-price]').removeAttr('id').html("+ " + price).css('display', "");
          $template.find('[id^="delivery_title_"]').html(d.title).removeAttr('id');
          $template.find('[id^="delivery_description_"]').html(d.description).removeAttr('id');
          $template.find('[id^="delivery_interval_"]').html((ref = d.delivery_interval) != null ? ref.description : void 0).removeAttr('id');
          $template.find('[id^="delivery_error_"]').html(d.errors.concat(d.warnings).join('<br>')).removeAttr('id').css('display', "");
          $template.find('[id^="delivery_details_"]').html('').removeAttr('id');
          $template.find('[id^="delivery_outlet_"]').html('').removeAttr('id');
          $template.find('label').addBack('label').attr('for', "tariff_" + tariff_id).removeAttr('style');
          $(tariffsBodySelector).append($template);
          $(tariffsBodySelector).find("#tariff_" + tariff_id).data('delivery-tariff', {
            delivery: delivery,
            tariff: d
          });
          if (typeof d.available !== 'undefined' && !d.available) {
            continue;
          }
        }
        if (delivery.selected) {
          $("#tariff_" + (delivery.delivery_info.tariff_id || ("none_" + delivery.id))).click();
        }
        if (delivery.selected && $(tariffsBodySelector).find('input:checked').length === 0) {
          return $(tariffsBodySelector).find('input').first().click();
        }
      },
      load: function($target, data) {
        var base, cache_key, externalParams, id, result;
        id = data.delivery_id;
        externalParams = {
          order: {
            delivery_variant_id: id,
            account_id: data.order.account_id,
            order_lines: $.map(data.order.order_lines, function(ol) {
              return {
                product_id: ol.product_id,
                variant_id: ol.variant_id,
                quantity: ol.quantity,
                weight: ol.weight,
                dimensions: ol.dimensions
              };
            }),
            shipping_address: {
              full_locality_name: data.order.shipping_address.full_locality_name,
              delivery_address: data.order.shipping_address.delivery_address,
              location: data.order.shipping_address.location
            },
            items_price: data.order.items_price,
            total_weight: data.order.total_weight
          }
        };
        cache_key = MD5(escape(this.deliveries[data.delivery_id].external_url + JSON.stringify(externalParams)));
        result = this.cache[cache_key];
        if (result) {
          return this.drawDelivery($target, result, data.delivery_id);
        }
        (base = this.ajaxRequests)[id] || (base[id] = {});
        if (this.ajaxRequests[id]['request'] && this.ajaxRequests[id]['request'].readyState !== 4) {
          if (this.ajaxRequests[id]['last_cache_key'] === cache_key) {
            return;
          }
          this.ajaxRequests[id]['request'].abort();
        }
        this.ajaxRequests[id]['last_cache_key'] = cache_key;
        return this.ajaxRequests[id]['request'] = $.ajax({
          url: this.deliveries[data.delivery_id].external_url,
          type: 'POST',
          dataType: 'json',
          contentType: 'application/json; charset=UTF-8',
          data: JSON.stringify(externalParams),
          success: (function(_this) {
            return function(result) {
              _this.cache[cache_key] = result;
              return _this.drawDelivery($target, result, data.delivery_id);
            };
          })(this)
        });
      }
    };
    $(function() {
      return ExternalDeliveryV2.init();
    });
    return {
      ExternalDeliveryV2: ExternalDeliveryV2
    };
  });

}).call(this);
(function() {
  define('shop/pick_up', ['jquery', './pick_up_maps/factory'], function($, MapFactory) {
    var checkLoadingStatus, createDetailInformation, createList, deliveryInput, deliveryInputElement, deliveryPickUpId, getRequestParams, loadPoints, mapFactory, mapLoader, markSelectedPoint, order, outletData, pointsLoadedFor, scrollToPoint, serializeOrder, updatePaymentMethod;
    deliveryInputElement = null;
    outletData = null;
    pointsLoadedFor = {};
    order = null;
    mapFactory = MapFactory({
      htmlGenerator: function(point, hideTitle) {
        var data, deliveryInterval, detailLink, html, ref, selectLink, shippingCompany, title;
        data = point;
        if (data.point_info_url && !data.price) {
          return "<div class='co-pick_up-point--in_balloon'><div class='co-pick_up-point_inner'>Идет загрузка</div></div>";
        }
        selectLink = "<a href='#' data-pickup-select-button='" + point.object_id + "' class='co-modal-button co-button co-button--small'>Выбрать</a>";
        detailLink = "<a href='#' class='co-link js-modal-toggler' data-target='.co-modal--outlet' data-pickup-detail-button='" + point.object_id + "'>Подробнее</a>";
        deliveryInterval = '';
        if ((ref = data.delivery_interval) != null ? ref.description : void 0) {
          deliveryInterval = "<div class='co-pick_up-point_field'>Срок доставки: " + data.delivery_interval.description + "</div>";
        }
        title = "<div class='co-pick_up-point_title co-pick_up-point_field'>" + data.title + "</div>";
        if (hideTitle) {
          title = '';
        }
        shippingCompany = "<div class='co-pick_up-point_field'>Доставка компанией: " + data.shipping_company + "</div>";
        if (!data.shipping_company) {
          shippingCompany = '';
        }
        return html = "<div class='co-pick_up-point--in_balloon'> <div class='co-pick_up-point_inner'> " + title + " <div class='co-pick_up-point_adress co-pick_up-point_field'>Адрес: " + data.address + "</div> <div class='co-pick_up-point_field'>Стоимость доставки: " + (InSales.formatMoney(data.price || 0)) + "</div> " + deliveryInterval + " " + shippingCompany + " <div class='co-pick_up-point_field'>" + selectLink + " " + detailLink + "</div> </div> </div>";
      }
    });
    mapLoader = mapFactory.mapLoader;
    createDetailInformation = function(mapObjectId, data) {
      var address, availablePaymentMethod, button, deliveryInterval, description, html, paymentMethod, phones, pointPaymentMethod, price, ref, shippingCompany;
      pointPaymentMethod = data.payment_method;
      if (!$.isArray(pointPaymentMethod)) {
        pointPaymentMethod = [];
      }
      shippingCompany = data.shipping_company ? "<div class='co-pick_up-point_field'>Доставка компанией: " + data.shipping_company + "</div>" : "";
      address = data.address ? "<div class='co-pick_up-point_address_modal co-pick_up-point_field'>" + data.address + "</div>" : "";
      description = data.description ? "<div class='co-pick_up-point_field'>" + data.description + "</div>" : "";
      phones = data.phones && data.phones.length !== 0 ? "<div class='co-pick_up-point_field'>Телефон: " + ((data.phones || []).join(', ')) + "</div>" : "";
      deliveryInterval = ((ref = data.delivery_interval) != null ? ref.description : void 0) ? "<div class='co-pick_up-point_field'>Срок доставки: " + data.delivery_interval.description + "</div>" : "";
      price = "<div class='co-pick_up-point_field'>Стоимость доставки: " + (InSales.formatMoney(data.price || 0)) + "</div>";
      button = "<button class='co-modal-button co-button co-button--small js-modal-close' data-pickup-select-button='" + mapObjectId + "'>Выбрать</button>";
      paymentMethod = '';
      availablePaymentMethod = [];
      if (pointPaymentMethod.some(function(p, index, array) {
        return p === 'CARD';
      })) {
        availablePaymentMethod.push("&nbsp;&nbsp;&nbsp;&nbsp;-&nbsp;Оплата картой");
      }
      if (pointPaymentMethod.some(function(p, index, array) {
        return p === 'CASH';
      })) {
        availablePaymentMethod.push("&nbsp;&nbsp;&nbsp;&nbsp;-&nbsp;Оплата наличными");
      }
      if (pointPaymentMethod.some(function(p, index, array) {
        return p === 'PREPAID';
      })) {
        availablePaymentMethod.push("&nbsp;&nbsp;&nbsp;&nbsp;-&nbsp;Предоплата магазину");
      }
      if (availablePaymentMethod.length > 0) {
        paymentMethod = "<div class='co-pick_up-point_field'>Доступные варианты оплаты:<br>" + (availablePaymentMethod.join('<br>')) + "</div>";
      }
      return html = "<div class='co-pick_up-point co-pick_up-point--in_modal'><div class='co-pick_up-point_inner'> " + address + " " + description + " " + phones + " " + price + " " + deliveryInterval + " " + shippingCompany + " " + paymentMethod + " </div></div> " + button;
    };
    createList = function() {
      var items, menu;
      menu = $(".co-pick_up-list--scrollable");
      items = '';
      return mapLoader.then(function(map) {
        var visiblePoints;
        visiblePoints = map.getPoints();
        visiblePoints.slice(0, 100).forEach(function(point) {
          var address, insalesPoint, shippingCompany;
          insalesPoint = point;
          address = insalesPoint.address ? "<span class='co-pick_up-point_adress co-pick_up-point_field'>" + insalesPoint.address + "</span>" : "";
          shippingCompany = insalesPoint.shipping_company ? insalesPoint.shipping_company + " - " : "";
          return items += "<div class='co-pick_up-item'> <button type='button' id='" + insalesPoint.object_id + "' class='co-pick_up-point co-pick_up-point--bordered' data-pick-up-point> <span class='co-pick_up-point_inner'> <span class='co-pick_up-point_title co-pick_up-point_field'>" + shippingCompany + " " + insalesPoint.title + "</span> " + address + " </span> </button> </div>";
        });
        menu.find('.co-pick_up-list_inner').html('').append(items);
        return markSelectedPoint(outletData != null ? outletData.id : void 0);
      });
    };
    updatePaymentMethod = function(outletData) {
      if ($('[data-payment-pickup]').length === 0) {
        return;
      }
      if (!outletData) {
        return;
      }
      return $('[data-payment-pickup]').data('payment-pickup', outletData.payment_method);
    };
    markSelectedPoint = function(id) {
      var target;
      $('.co-pick_up-list').find('.co-pick_up-point--selected').removeClass('co-pick_up-point--selected');
      target = $('.co-pick_up-list').find('[id="' + id + '"]');
      target.addClass('co-pick_up-point--selected');
      return scrollToPoint(target);
    };
    scrollToPoint = function($node) {
      if (!$node.length) {
        return;
      }
      return $('.co-pick_up-list--scrollable').scrollTop($node.position().top);
    };
    checkLoadingStatus = function(ajaxOnLoad) {
      if (!ajaxOnLoad) {
        return $(document).trigger('points_loaded:insales:delivery.pick_up.map');
      }
    };
    getRequestParams = function(pickUpSource, order) {
      if (!pickUpSource.method || pickUpSource.method === 'GET') {
        return {
          method: 'GET',
          dataType: 'jsonp',
          data: {
            items_price: order.items_price,
            total_weight: order.total_weight
          }
        };
      } else {
        return {
          method: 'POST',
          dataType: 'json',
          contentType: 'application/json; charset=UTF-8',
          data: JSON.stringify({
            order: serializeOrder(order)
          })
        };
      }
    };
    serializeOrder = function(order) {
      var location;
      location = order.shipping_address.location;
      return {
        account_id: order.account_id,
        order_lines: $.map(order.order_lines, function(ol) {
          return {
            product_id: ol.product_id,
            variant_id: ol.variant_id,
            quantity: ol.quantity,
            weight: ol.weight,
            dimensions: ol.dimensions
          };
        }),
        items_price: order.items_price,
        total_weight: order.total_weight,
        shipping_address: {
          full_locality_name: order.shipping_address.full_locality_name,
          location: {
            kladr_code: location.kladr_code,
            region_zip: location.region_zip,
            country: location.country,
            state: location.state,
            state_type: location.state_type,
            area: location.area,
            area_type: location.area_type,
            city: location.city,
            city_type: location.city_type,
            settlement: location.settlement,
            settlement_type: location.settlement_type
          }
        }
      };
    };
    deliveryPickUpId = function() {
      return $('[data-delivery-pickup]').val();
    };
    deliveryInput = function() {
      return deliveryInputElement || (deliveryInputElement = $("#order_delivery_variant_id_" + (deliveryPickUpId())));
    };
    loadPoints = function(order) {
      var ajaxOnLoad, deliverySource, locality, maxPrice, minPrice, priceRange;
      locality = order.shipping_address.full_locality_name || order.shipping_address.city;
      if (!locality) {
        return;
      }
      $('.co-pick_up-item--loading').show();
      mapLoader.then(function(map) {
        return map.setDetailInfoFunction(function(url, point_id) {
          return $.ajax({
            url: url,
            method: 'POST',
            dataType: 'json',
            contentType: 'application/json; charset=UTF-8',
            data: JSON.stringify({
              id: point_id,
              order: serializeOrder(order)
            })
          });
        });
      });
      deliverySource = $('[data-delivery-pickup]').data('delivery-pickup') || [];
      ajaxOnLoad = deliverySource.length;
      minPrice = null;
      maxPrice = null;
      priceRange = {};
      return $.each(deliverySource, function(k, v) {
        var cacheKey, requestParams;
        requestParams = getRequestParams(v, order);
        cacheKey = MD5(escape(JSON.stringify(requestParams) + v.url));
        if (pointsLoadedFor[cacheKey] === 'loading') {
          return true;
        }
        if (pointsLoadedFor[cacheKey] === 'loaded') {
          ajaxOnLoad -= 1;
          checkLoadingStatus(ajaxOnLoad);
          mapLoader.then(function(map) {
            return map.markSelectedPoint(outletData != null ? outletData.id : void 0);
          });
          return;
        }
        pointsLoadedFor[cacheKey] = 'loading';
        return $.ajax($.extend({}, {
          url: v.url
        }, requestParams)).done(function(data) {
          ajaxOnLoad -= 1;
          checkLoadingStatus(ajaxOnLoad);
          pointsLoadedFor[cacheKey] = 'loaded';
          if (!data || (data != null ? data.error : void 0)) {
            console.warn('Ошибка при загрузке точек доставки');
            return;
          }
          $.each(data, function(k, v) {
            if (!v.price) {
              return;
            }
            minPrice || (minPrice = v.price);
            maxPrice || (maxPrice = v.price);
            if (v.price > maxPrice) {
              maxPrice = v.price;
            }
            if (v.price < minPrice) {
              return minPrice = v.price;
            }
          });
          if (minPrice) {
            priceRange['min'] = minPrice;
          }
          if (maxPrice) {
            priceRange['max'] = maxPrice;
          }
          deliveryInput().triggerCustom('update:insales:delivery', {
            price_range: priceRange
          });
          return mapLoader.then(function(map) {
            map.loadPoints(v, data);
            return map.markSelectedPoint(outletData != null ? outletData.id : void 0);
          });
        });
      });
    };
    $(document).on('points_loaded:insales:delivery.pick_up.map', function() {
      console.warn('loaded');
      return $('.co-pick_up-item--loading').hide();
    });
    $(document).on('change', '[data-onepage-checkout] #shipping_address_country', function() {
      if ($('#pick-up-map').length === 0) {
        return;
      }
      $('.co-modal-controls').html("");
      outletData = null;
      return deliveryInput().triggerCustom('update:insales:delivery', {
        delivery_info: {
          outlet: {},
          price: null
        }
      });
    });
    $(document).on('typeahead:selected.address-autocomplete typeahead:autocompleted.address-autocomplete cleaned.address-autocomplete', '[data-onepage-checkout]', function(e) {
      if ($('#pick-up-map').length === 0) {
        return;
      }
      $('.co-modal-controls').html("");
      outletData = null;
      return deliveryInput().triggerCustom('update:insales:delivery', {
        delivery_info: {
          outlet: {},
          price: null
        }
      });
    });
    $(document).on('locality_changed:insales:delivery.pick_up.map', function(e, searchResult) {
      var country;
      if (!searchResult) {
        return $('.co-modal-controls').html("<div style='color: red'>Не удалось определить регион и город</div>");
      }
      country = order.shipping_address.country || 'RU';
      return $.ajax({
        url: "https://kladr.insales.ru/fulltext_search.json?country=" + country + "&with_parent=1&q=" + searchResult.full_locality_name,
        dataType: 'jsonp',
        timeout: 2000
      }).done((function(_this) {
        return function(results) {
          var data;
          data = results[0];
          if (!(data != null ? data.result : void 0) || data.country !== searchResult.country) {
            return $('.co-modal-controls').html("<div style='color: red'>Не удалось определить регион и город</div>");
          }
          $('.co-modal-locality').html(" - " + data.result);
          $('.co-modal-controls').html("");
          order.shipping_address.location = data;
          order.shipping_address.full_locality_name = data.result;
          loadPoints(order);
          mapLoader.then(function(map) {
            return map.setPosition(searchResult);
          });
          return $(document).trigger('locality_changed.address-autocomplete', data);
        };
      })(this));
    });
    $(document).on('inited:insales:checkout:payments', function(e, data) {
      var $input, otherPaymentsAvailable, paymentMethod, pickUpPaymentAvailable, ref;
      if ($('#pick-up-map').length === 0) {
        return;
      }
      if (!$('[data-delivery-pickup]').is(':checked')) {
        return;
      }
      data || (data = (ref = e.originalEvent) != null ? ref.detail : void 0);
      $input = $('[data-payment-pickup]');
      paymentMethod = $input.data('payment-pickup');
      if (!paymentMethod || !$.isArray(paymentMethod) || paymentMethod.length === 0) {
        paymentMethod = ['CASH', 'CARD', 'PREPAID'];
      }
      $.each(data.payments, function(k, v) {
        if (v.id === parseInt($input.val())) {
          return $("#payment_description_" + ($input.val())).html(v.description);
        }
      });
      pickUpPaymentAvailable = paymentMethod.some(function(p, index, array) {
        return p === 'CARD' || p === 'CASH';
      });
      otherPaymentsAvailable = paymentMethod.some(function(p, index, array) {
        return p === 'PREPAID';
      });
      if (!otherPaymentsAvailable) {
        $('#payment_gateways').find('[id^="order_payment_gateway_id_"]').not("#order_payment_gateway_id_" + ($input.val())).triggerCustom('disable:insales:payment');
      }
      if (pickUpPaymentAvailable) {
        return $input.triggerCustom('enable:insales:payment');
      } else {
        return $input.triggerCustom('disable:insales:payment');
      }
    });
    $(document).on('click', '[data-pickup-detail-button]', function(e) {
      var objectId;
      e.preventDefault();
      objectId = $(this).data('pickup-detail-button');
      return mapLoader.then(function(map) {
        var $modal, data, modalTemplate;
        data = map.getPointInfo(objectId);
        modalTemplate = createDetailInformation(objectId, data);
        $modal = $('.co-modal--outlet');
        $modal.find('.co-modal-title').html(data.title);
        return $modal.find('.js-modal-body').html(modalTemplate);
      });
    });
    $(document).on('click', '[data-pickup-select-button]', function(e) {
      var objectId;
      e.preventDefault();
      objectId = $(this).data('pickup-select-button');
      return mapLoader.then(function(map) {
        var data, newDeliveryData;
        data = map.getPointInfo(objectId);
        map.selectPoint(objectId);
        newDeliveryData = {
          delivery_info: {
            price: data.price,
            delivery_interval: data.delivery_interval,
            shipping_company: data.shipping_company,
            fields_values: data.fields_values,
            title: data.source_title,
            outlet: {
              id: objectId,
              external_id: data.id,
              type: data.type,
              latitude: data.latitude,
              longitude: data.longitude,
              title: data.title,
              address: data.address,
              phones: data.phones,
              description: data.description,
              payment_method: data.payment_method,
              source_id: data.source_id
            }
          }
        };
        outletData = newDeliveryData.delivery_info.outlet;
        updatePaymentMethod(data);
        markSelectedPoint(objectId);
        deliveryInput().triggerCustom('update:insales:delivery', newDeliveryData);
        deliveryInput().triggerCustom('allowSubmit:insales:delivery');
        deliveryInput().click();
        ModalClose($('.co-modal--outlet'));
        return ModalClose($('.co-modal--pick_up_modal'));
      });
    });
    $(document).on('click', '[data-pick-up-point]', function(e) {
      var objectId;
      objectId = $(this).attr('id');
      return mapLoader.then(function(map) {
        return map.showPointInfo(objectId);
      });
    });
    $(document).on('click', '[data-open-pickup-map]', function(e) {
      var locality;
      e.preventDefault();
      locality = order.shipping_address.full_locality_name || order.shipping_address.city;
      if (!locality) {
        return $(deliveryInput()).triggerCustom('error:insales:delivery', 'Укажите населенный пункт');
      }
      $('.co-modal-locality').html(" - " + locality);
      $('.co-modal-controls').html("");
      return mapLoader.then(function(map) {
        var target;
        target = $(e.target).data('target');
        ModalOpen($(target), e);
        if ((outletData != null ? outletData.latitude : void 0) && (outletData != null ? outletData.longitude : void 0)) {
          return map.setPosition({
            center: [outletData.latitude, outletData.longitude],
            zoom: 16
          });
        }
        return map.findPosition(locality).done(function(searchResult) {
          if (!searchResult) {
            return;
          }
          return map.setPosition(searchResult);
        });
      });
    });
    $(document).on('points_updated:insales:delivery.pick_up.map', function(e) {
      return createList();
    });
    $(document).on('inited:insales:checkout:deliveries.pick_up', function(e, data) {
      var ref;
      if ($('#pick-up-map').length === 0) {
        return;
      }
      data || (data = (ref = e.originalEvent) != null ? ref.detail : void 0);
      order = data.order;
      if (!(outletData != null ? outletData.latitude : void 0) || !(outletData != null ? outletData.longitude : void 0)) {
        deliveryInput().triggerCustom('preventSubmit:insales:delivery');
      } else {
        deliveryInput().triggerCustom('allowSubmit:insales:delivery');
      }
      updatePaymentMethod(outletData);
      if (!mapLoader.isResolved()) {
        mapFactory.init({
          shippingCompanies: $('[data-shipping-companies]').data('shipping-companies') || []
        });
      }
      return loadPoints(order);
    });
    return $(function() {
      if ($('#pick-up-map').length === 0) {
        return;
      }
      outletData = $('[data-delivery-variants]').data('delivery-variants')[deliveryPickUpId()].delivery_info.outlet;
      return deliveryInput().on('submitPrevented:insales:checkout', function(e) {
        return $(this).triggerCustom('error:insales:delivery', 'Не выбрана точка самовывоза');
      });
    });
  });

}).call(this);
(function() {
  define('shop/pick_point', ['jquery'], function($) {
    var InSalesPickPoint, PickPoint;
    InSalesPickPoint = PickPoint = (function() {
      PickPoint.instances = {};

      PickPoint.humanValueToHtml = function(humanValue) {
        if (!humanValue) {
          return;
        }
        return "<p>" + (humanValue.replace(/[\r\n]+/g, '<br/>')) + "</p>";
      };

      PickPoint.bind = function() {
        $(document).on('click', '.pickpoint_link', function() {
          return PickPoint.instances[$(this).data('deliveryVariantId')].openModal();
        });
        $(document).on('selected:insales:checkout:delivery', (function(_this) {
          return function(e, order) {
            order || (order = e.originalEvent.detail);
            if (!_this.instances[order.delivery.id]) {
              return true;
            }
            return _this.instances[order.delivery.id].currentCity = order.shipping_address.city;
          };
        })(this));
        return $(document).on('inited:insales:checkout:deliveries', (function(_this) {
          return function(e, data) {
            var delivery, deliveryId, fv, pp, ref, results;
            data || (data = e.originalEvent.detail);
            ref = _this.instances;
            results = [];
            for (deliveryId in ref) {
              pp = ref[deliveryId];
              fv = $.grep(data.order.fields_values || [], function(v, k) {
                return v.field_id === pp.fieldId;
              })[0] || {};
              delivery = data.deliveries[pp.id];
              if (!delivery) {
                continue;
              }
              if (pp.inited) {
                $(delivery.html_id).triggerCustom('update:insales:delivery');
                continue;
              }
              fv = $.extend({}, fv, {
                human_value: _this.humanValueToHtml(fv.human_value)
              });
              $(delivery.html_id).triggerCustom('update:insales:delivery', {
                fields_values: [fv],
                is_external: true,
                description: null
              });
              results.push(pp.inited = true);
            }
            return results;
          };
        })(this));
      };

      function PickPoint(options) {
        this.id = options.id, this.cities = options.cities, this.fromCity = options.fromCity, this.fieldId = options.fieldId;
        this.currentCity = null;
        this.inited = false;
        this.constructor.instances[this.id] = this;
      }

      PickPoint.prototype.ensureSelected = function() {
        if (!this.input().is(':checked')) {
          return this.input().click();
        }
      };

      PickPoint.prototype.input = function() {
        return $("#order_delivery_variant_id_" + this.id);
      };

      PickPoint.prototype.openModal = function() {
        var city, ref;
        this.ensureSelected();
        city = (ref = this.cities[this.currentCity]) != null ? ref : 'moscow';
        return window.PickPoint.open((function(_this) {
          return function(result) {
            var e;
            try {
              return _this.calculate(result);
            } catch (error) {
              e = error;
              console.error(e);
              throw e;
            }
          };
        })(this), {
          city: city,
          fromcity: this.fromCity
        });
      };

      PickPoint.prototype.calculate = function(fields) {
        var data, fields_values, ref;
        if (fields == null) {
          fields = {};
        }
        this.input().triggerCustom('calculating:insales:delivery');
        data = {
          _method: 'put',
          order: {
            delivery_variant_id: (ref = fields.delivery_variant_id) != null ? ref : this.id
          },
          cart: {
            fields_values_attributes: fields_values = {}
          }
        };
        fields_values[this.fieldId] = {
          field_id: this.fieldId,
          value: JSON.stringify({
            id: fields.id,
            address: fields.address,
            zone: fields.zone,
            coeff: fields.coeff
          })
        };
        return $.post('/cart_items.json', data, (function(_this) {
          return function(response) {
            var ppInfo, ref1;
            ppInfo = (ref1 = $.grep(response.order.fields_values_attributes, function(x) {
              return x.field_id === _this.fieldId;
            })[0]) != null ? ref1.human_value : void 0;
            if (ppInfo) {
              fields_values[_this.fieldId]['human_value'] = PickPoint.humanValueToHtml(ppInfo);
            }
            return _this.input().triggerCustom('update:insales:delivery', {
              fields_values: fields_values,
              price: response.order.delivery_price,
              description: null
            });
          };
        })(this), 'json');
      };

      return PickPoint;

    })();
    $(function() {
      return PickPoint.bind();
    });
    return {
      InSalesPickPoint: InSalesPickPoint
    };
  });

}).call(this);
(function() {
  define('shop/pick_up_maps/factory', ['jquery', './map_yandex', './map_google'], function($, yandex, google) {
    var maps;
    maps = {
      yandex: yandex,
      google: google
    };
    return function(options) {
      var activeMap, map, mapType;
      activeMap = $('meta[name="map-type"]').attr('content');
      mapType = maps[activeMap];
      map = new mapType(options);
      return map;
    };
  });

}).call(this);
(function() {
  var bind = function(fn, me){ return function(){ return fn.apply(me, arguments); }; };

  define('shop/pick_up_maps/map_yandex', ['jquery'], function($) {
    var Map;
    return Map = (function() {
      function Map(options) {
        this.initMap = bind(this.initMap, this);
        this.options = options;
        this.shippingCompanies = {};
        this.listBoxTypes = {
          "shop_outlet": "Точки магазина",
          "locker": "Постаматы",
          "pvz": "Пункты выдачи заказов"
        };
        this.availableShippingCompanies = {};
        this.mapLoader = $.Deferred();
        this.loadScript().then((function(_this) {
          return function() {
            return _this.ymaps = insYmaps;
          };
        })(this));
      }

      Map.prototype.loadScript = function() {
        return this.script || (this.script = $.ajax({
          dataType: "script",
          cache: true,
          url: "https://api-maps.yandex.ru/2.1/?lang=ru_RU&ns=insYmaps"
        }));
      };

      Map.prototype.init = function(options) {
        $.each(options.shippingCompanies, (function(_this) {
          return function(k, v) {
            return _this.shippingCompanies[v.handle] = v.title;
          };
        })(this));
        this.shippingCompanies['misc'] = 'Остальные';
        this.loadScript().then((function(_this) {
          return function() {
            return _this.ymaps.ready(_this.initMap);
          };
        })(this));
        return this.mapLoader;
      };

      Map.prototype.initMap = function() {
        this.createMapInstance();
        this.initObjectManager();
        this.createSearchControl();
        this.createPointTypesListBox();
        this.initEvents();
        return this.mapLoader.resolve(this);
      };

      Map.prototype.createMapInstance = function(center, zoom) {
        return this.map = new this.ymaps.Map('pick-up-map', {
          center: center || [55.76, 37.64],
          zoom: zoom || 10,
          controls: ['zoomControl', 'typeSelector'],
          options: {
            fitToViewport: 'always'
          }
        });
      };

      Map.prototype.createSearchControl = function() {
        var searchControl;
        searchControl = new this.ymaps.control.SearchControl({
          options: {
            provider: 'yandex#map',
            noCentering: true,
            noPlacemark: true,
            suppressYandexSearch: true
          }
        });
        searchControl.events.add('resultselect', (function(_this) {
          return function(e) {
            var index;
            index = e.get('index');
            return searchControl.getResult(index).then(function(res) {
              var fullLocalityName, localityParts, yaAdministrativeArea, yaLocality;
              console.log(res);
              localityParts = [];
              yaAdministrativeArea = res.getAdministrativeAreas()[0];
              yaLocality = res.getLocalities()[0];
              if (yaAdministrativeArea) {
                localityParts.push(yaAdministrativeArea);
              }
              if (yaLocality && yaLocality !== yaAdministrativeArea) {
                localityParts.push(yaLocality);
              }
              fullLocalityName = localityParts.join(', ');
              return _this.triggerAddressChanged({
                bounds: res.properties.get('boundedBy'),
                full_locality_name: fullLocalityName,
                country: res.getCountryCode()
              });
            });
          };
        })(this));
        return this.map.controls.add(searchControl);
      };

      Map.prototype.initObjectManager = function() {
        this.objectManager = new this.ymaps.ObjectManager({
          clusterize: true,
          gridSize: 32
        });
        this.objectManager.clusters.events.add('click', (function(_this) {
          return function(e) {
            var cluster;
            cluster = _this.objectManager.clusters.getById(e.get('objectId'));
            if (_this.map.getZoom() < _this.map.zoomRange.getCurrent()[1]) {
              return cluster;
            }
            return _this.showClusterInfo(cluster);
          };
        })(this));
        this.objectManager.objects.events.add('click', (function(_this) {
          return function(e) {
            var objectId;
            console.log;
            objectId = e.get('objectId');
            return _this.showPointInfo(objectId);
          };
        })(this));
        this.objectManager.clusters.options.set({
          openBalloonOnClick: false
        });
        this.map.geoObjects.add(this.objectManager);
        return this.map.container.fitToViewport();
      };

      Map.prototype.initEvents = function() {
        return this.map.events.add(['boundschange', 'datachange', 'objecttypeschange'], (function(_this) {
          return function() {
            return _this.triggerUpdateData();
          };
        })(this));
      };

      Map.prototype.setDetailInfoFunction = function(detailInfoFunction) {
        return this.detailInfoFunction = detailInfoFunction;
      };

      Map.prototype.loadPoints = function(source, data) {
        var points;
        points = this.createPoints(source, data);
        this.objectManager.add(points);
        return this.triggerUpdateData();
      };

      Map.prototype.getPoints = function() {
        var bounds, iterator, object, visiblePoints;
        visiblePoints = [];
        bounds = this.map.getBounds();
        iterator = this.objectManager.objects.getIterator();
        while (object = iterator.getNext()) {
          if (visiblePoints.length === 100) {
            break;
          }
          if ($.isEmptyObject(object)) {
            break;
          }
          if (this.checkPointVisibility(object, bounds)) {
            visiblePoints.push(object.properties.insalesData);
          }
        }
        return visiblePoints;
      };

      Map.prototype.triggerAddressChanged = function(newAddress) {
        return $(document).trigger('locality_changed:insales:delivery.pick_up.map', newAddress);
      };

      Map.prototype.triggerUpdateData = function() {
        return $(document).trigger('points_updated:insales:delivery.pick_up.map');
      };

      Map.prototype.createPoints = function(source, data) {
        return {
          type: "FeatureCollection",
          features: $.map(data || [], (function(_this) {
            return function(point, k) {
              var objectId;
              objectId = MD5(source.url + "_" + point.id);
              if (_this.shippingCompanies[point.shipping_company_handle] && !_this.shippingCompaniesListBoxControl) {
                _this.createShippingCompaniesListBox();
              }
              if (_this.shippingCompanies[point.shipping_company_handle] && !_this.availableShippingCompanies[point.shipping_company_handle]) {
                _this.addShippingComany(point.shipping_company_handle);
              }
              if (!_this.shippingCompanies[point.shipping_company_handle] && !_this.availableShippingCompanies['misc']) {
                _this.addShippingComany('misc');
              }
              return {
                id: objectId,
                type: "Feature",
                geometry: {
                  type: "Point",
                  coordinates: [point.latitude, point.longitude]
                },
                properties: {
                  insalesData: $.extend({
                    point_info_url: source.point_info_url,
                    source_id: source.id,
                    source_title: source.title
                  }, point, {
                    object_id: objectId
                  }),
                  hintContent: point.title,
                  clusterCaption: point.title
                }
              };
            };
          })(this))
        };
      };

      Map.prototype.getPointInfo = function(objectId) {
        var obj;
        obj = this.objectManager.objects.getById(objectId);
        return obj.properties.insalesData;
      };

      Map.prototype.setPosition = function(data) {
        this.map.container.fitToViewport();
        if (data != null ? data.bounds : void 0) {
          return this.map.setBounds(data.bounds);
        }
        if (data != null ? data.center : void 0) {
          return this.map.setCenter(data.center, (data != null ? data.zoom : void 0) || 10);
        }
      };

      Map.prototype.markSelectedPoint = function(objectId) {
        if (this.prevSelectedObjectId) {
          this.objectManager.objects.setObjectOptions(this.prevSelectedObjectId, {
            preset: 'islands#blueIcon'
          });
        }
        this.prevSelectedObjectId = objectId;
        if (!objectId) {
          return;
        }
        return this.objectManager.objects.setObjectOptions(objectId, {
          preset: 'islands#redDotIcon'
        });
      };

      Map.prototype.findPosition = function(locality) {
        if (!locality) {
          return $.Deferred().reject();
        }
        this.lastSearchResult = $.Deferred();
        if (this.lastSearchQuery && this.lastSearchQuery === locality) {
          return this.lastSearchResult;
        }
        this.lastSearchQuery = locality;
        this.ymaps.geocode(locality).then((function(_this) {
          return function(res) {
            var mapState;
            mapState = _this.getMapState(res.geoObjects.get(0));
            return _this.lastSearchResult.resolve({
              center: mapState.center
            });
          };
        })(this));
        return this.lastSearchResult;
      };

      Map.prototype.showPointInfo = function(objectId) {
        var point;
        point = this.objectManager.objects.getById(objectId);
        if (point.properties.balloonContent) {
          return this.objectManager.objects.balloon.open(objectId);
        } else {
          point.properties.balloonContent = this.options.htmlGenerator(point.properties.insalesData);
          if (point.properties.insalesData.point_info_url && !point.properties.insalesData.price) {
            this.detailInfoFunction(point.properties.insalesData.point_info_url, point.properties.insalesData.id).done((function(_this) {
              return function(pointInfo) {
                point.properties.insalesData = $.extend({}, point.properties.insalesData, pointInfo, {
                  point_info_url: null
                });
                point.properties.balloonContent = _this.options.htmlGenerator(point.properties.insalesData);
                return _this.objectManager.objects.balloon.open(objectId);
              };
            })(this));
          }
          return this.objectManager.objects.balloon.open(objectId);
        }
      };

      Map.prototype.showClusterInfo = function(cluster) {
        $.map(cluster.properties.geoObjects, (function(_this) {
          return function(point, k) {
            return point.properties.balloonContent = _this.options.htmlGenerator(point.properties.insalesData, true);
          };
        })(this));
        return this.objectManager.clusters.balloon.open(cluster.id);
      };

      Map.prototype.checkPointVisibility = function(point, bounds) {
        var coordinates, inBounds, objectState, ref, ref1, show;
        objectState = this.objectManager.getObjectState(point.id);
        coordinates = point.geometry.coordinates;
        if (coordinates) {
          inBounds = (bounds[0][0] <= (ref = coordinates[0]) && ref <= bounds[1][0]) && (bounds[0][1] <= (ref1 = coordinates[1]) && ref1 <= bounds[1][1]);
        }
        return show = objectState.isShown && inBounds;
      };

      Map.prototype.addShippingComany = function(shippingCompanyHandle) {
        var filters, listBoxItem, title;
        title = this.shippingCompanies[shippingCompanyHandle];
        this.availableShippingCompanies[shippingCompanyHandle] = title;
        if (!this.shippingCompaniesListBoxControl) {
          return;
        }
        listBoxItem = new this.ymaps.control.ListBoxItem({
          data: {
            content: title
          },
          state: {
            selected: true
          }
        });
        this.shippingCompaniesListBoxControl.add(listBoxItem);
        filters = this.shippingCompaniesListBoxControl.state.get('filters');
        filters[title] = true;
        return this.shippingCompaniesListBoxControl.state.set('filters', filters);
      };

      Map.prototype.createShippingCompaniesListBox = function() {
        var filterMonitor, listBoxItems;
        listBoxItems = $.map(this.availableShippingCompanies, (function(_this) {
          return function(title, _) {
            return new _this.ymaps.control.ListBoxItem({
              data: {
                content: title
              },
              state: {
                selected: true
              }
            });
          };
        })(this));
        this.shippingCompaniesListBoxControl = new this.ymaps.control.ListBox({
          data: {
            content: 'Служба доставки',
            title: 'Служба доставки'
          },
          items: listBoxItems,
          state: {
            expanded: false,
            filters: listBoxItems.reduce(function(filters, filter) {
              filters[filter.data.get('content')] = filter.isSelected();
              return filters;
            }, {})
          }
        });
        this.map.controls.add(this.shippingCompaniesListBoxControl);
        this.shippingCompaniesListBoxControl.events.add(['select', 'deselect'], (function(_this) {
          return function(e) {
            var filters, listBoxItem;
            listBoxItem = e.get('target');
            filters = _this.ymaps.util.extend({}, _this.shippingCompaniesListBoxControl.state.get('filters'));
            filters[listBoxItem.data.get('content')] = listBoxItem.isSelected();
            _this.shippingCompaniesListBoxControl.state.set('filters', filters);
            return _this.triggerUpdateData();
          };
        })(this));
        filterMonitor = new this.ymaps.Monitor(this.shippingCompaniesListBoxControl.state);
        return filterMonitor.add('filters', (function(_this) {
          return function(filters) {
            return _this.objectManager.setFilter(_this.pointsFilter.bind(_this));
          };
        })(this));
      };

      Map.prototype.createPointTypesListBox = function() {
        var filterMonitor, listBoxItems;
        listBoxItems = $.map(this.listBoxTypes, (function(_this) {
          return function(title, _) {
            return new _this.ymaps.control.ListBoxItem({
              data: {
                content: title
              },
              state: {
                selected: true
              }
            });
          };
        })(this));
        this.pointTypesListBoxControl = new this.ymaps.control.ListBox({
          data: {
            content: 'Тип точки',
            title: 'Тип точки'
          },
          items: listBoxItems,
          state: {
            expanded: false,
            filters: listBoxItems.reduce(function(filters, filter) {
              filters[filter.data.get('content')] = filter.isSelected();
              return filters;
            }, {})
          }
        });
        this.map.controls.add(this.pointTypesListBoxControl);
        this.pointTypesListBoxControl.events.add(['select', 'deselect'], (function(_this) {
          return function(e) {
            var filters, listBoxItem;
            listBoxItem = e.get('target');
            filters = _this.ymaps.util.extend({}, _this.pointTypesListBoxControl.state.get('filters'));
            filters[listBoxItem.data.get('content')] = listBoxItem.isSelected();
            _this.pointTypesListBoxControl.state.set('filters', filters);
            return _this.triggerUpdateData();
          };
        })(this));
        filterMonitor = new this.ymaps.Monitor(this.pointTypesListBoxControl.state);
        return filterMonitor.add('filters', (function(_this) {
          return function(filters) {
            return _this.objectManager.setFilter(_this.pointsFilter.bind(_this));
          };
        })(this));
      };

      Map.prototype.pointsFilter = function(obj) {
        var pointShippingCompanyHandle, pointType, pointTypesFilters, shippingCompaniesFilters;
        pointType = obj.properties.insalesData.type;
        pointShippingCompanyHandle = obj.properties.insalesData.shipping_company_handle;
        pointTypesFilters = this.pointTypesListBoxControl.state.get('filters');
        if (this.shippingCompaniesListBoxControl) {
          shippingCompaniesFilters = this.shippingCompaniesListBoxControl.state.get('filters');
        }
        if (!pointTypesFilters[this.listBoxTypes[pointType]]) {
          return false;
        }
        if (!shippingCompaniesFilters) {
          return true;
        }
        return shippingCompaniesFilters[this.availableShippingCompanies[pointShippingCompanyHandle]] || (!this.availableShippingCompanies[pointShippingCompanyHandle] && shippingCompaniesFilters[this.availableShippingCompanies['misc']]);
      };

      Map.prototype.getMapState = function(geoObject) {
        var bounds;
        bounds = geoObject.properties.get('boundedBy');
        return this.ymaps.util.bounds.getCenterAndZoom(bounds, [$('#pick-up-map').width(), $('#pick-up-map').height()]);
      };

      Map.prototype.selectPoint = function(objectId) {
        this.markSelectedPoint(objectId);
        this.objectManager.clusters.balloon.close();
        return this.objectManager.objects.balloon.close();
      };

      return Map;

    })();
  });

}).call(this);
(function() {
  var bind = function(fn, me){ return function(){ return fn.apply(me, arguments); }; };

  define('shop/pick_up_maps/map_google', ['jquery'], function($) {
    var Map;
    return Map = (function() {
      function Map(options) {
        this.initMap = bind(this.initMap, this);
        this.options = options;
        this.mapLoader = $.Deferred();
        this.markers = {};
        this.loadScript().then((function(_this) {
          return function() {
            return _this.gmaps = google.maps;
          };
        })(this));
      }

      Map.prototype.loadScript = function() {
        return this.script || (this.script = $.when($.ajax({
          dataType: "script",
          cache: true,
          url: "https://maps.googleapis.com/maps/api/js?key=AIzaSyBJUhzK6ljhWX9KJpzs26VlyrHszQ1EgxE"
        }), $.ajax({
          dataType: "script",
          cache: true,
          url: "https://developers.google.com/maps/documentation/javascript/examples/markerclusterer/markerclusterer.js"
        })));
      };

      Map.prototype.init = function() {
        this.loadScript().then((function(_this) {
          return function() {
            return _this.initMap();
          };
        })(this));
        return this.mapLoader;
      };

      Map.prototype.initMap = function() {
        this.createMapInstance();
        this.createInfoWindow();
        this.createCluster();
        this.initEvents();
        return this.mapLoader.resolve(this);
      };

      Map.prototype.initEvents = function() {
        return this.map.addListener('bounds_changed', (function(_this) {
          return function() {
            return _this.triggerUpdateData();
          };
        })(this));
      };

      Map.prototype.createMapInstance = function(center, zoom) {
        center || (center = []);
        return this.map = new this.gmaps.Map(document.getElementById('pick-up-map'), {
          zoom: zoom || 10,
          center: {
            lat: center[0] || 55.76,
            lng: center[1] || 37.64
          },
          streetViewControl: false,
          fullscreenControl: false
        });
      };

      Map.prototype.createCluster = function() {
        return this.markerCluster = new MarkerClusterer(this.map, [], {
          imagePath: 'https://developers.google.com/maps/documentation/javascript/examples/markerclusterer/m'
        });
      };

      Map.prototype.createInfoWindow = function() {
        return this.infoWindow || (this.infoWindow = new this.gmaps.InfoWindow({
          maxWidth: 400
        }));
      };

      Map.prototype.findPosition = function(locality) {
        this.geocoder || (this.geocoder = new this.gmaps.Geocoder());
        if (!locality) {
          return $.Deferred().reject();
        }
        this.lastSearchResult = $.Deferred();
        if (this.lastSearchQuery && this.lastSearchQuery === locality) {
          return this.lastSearchResult;
        }
        this.lastSearchQuery = locality;
        this.geocoder.geocode({
          'address': locality
        }, (function(_this) {
          return function(results, status) {
            var location;
            if (!(status === 'OK')) {
              return _this.lastSearchResult.reject();
            }
            location = results[0].geometry.location;
            return _this.lastSearchResult.resolve({
              center: [location.lat(), location.lng()]
            });
          };
        })(this));
        return this.lastSearchResult;
      };

      Map.prototype.setPosition = function(data) {
        if (!(data != null ? data.center : void 0)) {
          return;
        }
        this.map.setCenter({
          lat: parseFloat(data.center[0]),
          lng: parseFloat(data.center[1])
        });
        return this.map.setZoom((data != null ? data.zoom : void 0) || 10);
      };

      Map.prototype.markSelectedPoint = function(objectId) {};

      Map.prototype.setDetailInfoFunction = function(detailInfoFunction) {
        return this.detailInfoFunction = detailInfoFunction;
      };

      Map.prototype.triggerUpdateData = function() {
        return $(document).trigger('points_updated:insales:delivery.pick_up.map');
      };

      Map.prototype.getPointInfo = function(objectId) {
        return this.markers[objectId].insalesData;
      };

      Map.prototype.loadPoints = function(source, data) {
        $.each(data, (function(_this) {
          return function(k, point) {
            var marker, objectId;
            objectId = MD5(source.url + "_" + point.id);
            point = $.extend({
              point_info_url: source.point_info_url,
              source_id: source.id,
              source_title: source.title
            }, point, {
              object_id: objectId
            });
            marker = new _this.gmaps.Marker({
              position: {
                lat: parseFloat(point.latitude),
                lng: parseFloat(point.longitude)
              },
              map: _this.map,
              title: point.title,
              insalesData: point
            });
            marker.addListener('click', _this.showPointInfo.bind(_this, objectId));
            _this.markerCluster.addMarker(marker, false);
            return _this.markers[objectId] = marker;
          };
        })(this));
        this.markerCluster.redraw();
        return this.triggerUpdateData();
      };

      Map.prototype.showPointInfo = function(objectId) {
        var marker;
        marker = this.markers[objectId];
        this.infoWindow.setContent(this.options.htmlGenerator(marker.insalesData));
        return this.infoWindow.open(this.map, marker);
      };

      Map.prototype.getPoints = function() {
        var visiblePoints;
        visiblePoints = [];
        $.each(this.markers, (function(_this) {
          return function(k, marker) {
            var point;
            if (visiblePoints.length === 100) {
              return false;
            }
            point = marker.insalesData;
            if (_this.map.getBounds().contains({
              lat: parseFloat(point.latitude),
              lng: parseFloat(point.longitude)
            })) {
              return visiblePoints.push(point);
            }
          };
        })(this));
        return visiblePoints;
      };

      Map.prototype.selectPoint = function(objectId) {
        return this.infoWindow.close();
      };

      return Map;

    })();
  });

}).call(this);
(function() {
  define('shop/onepage_checkout', ['jquery', 'shop/checkout/checkout'], function($, checkout_common) {
    var debounced_deliveries, debounced_payments, deliveries_request, delivery_error_reported, delivery_errors_counter, disable_element, enable_element, get_deferred_deliveries, get_deferred_payments, get_deliveries, get_payments, payment_error_reported, payment_errors_counter, payments_request, set_deliveries_query;
    delivery_errors_counter = 0;
    payment_errors_counter = 0;
    delivery_error_reported = false;
    payment_error_reported = false;
    deliveries_request = null;
    payments_request = null;
    get_deferred_deliveries = function() {
      return deliveries_request = get_deliveries();
    };
    get_deliveries = function() {
      var default_locale;
      $(document).triggerCustom('loading:insales:deliveries');
      default_locale = $('meta[name=default-locale]').attr('content');
      return $.ajax({
        url: "/delivery/for_order.json?lang=" + default_locale + "&v2=" + ($('[data-checkout2]').length > 0),
        type: 'PUT',
        dataType: 'json',
        data: $('#order_form').formSerialize(),
        timeout: 10000,
        success: function(data) {
          delivery_errors_counter = 0;
          $(document).trigger('calc_delivery');
          $(document).triggerCustom('loaded:insales:order', data.order);
          return $(document).triggerCustom('loaded:insales:deliveries', data.deliveries);
        },
        error: function(xhr, status, error_thrown) {
          if (status !== 'error' && status !== 'timeout') {
            return;
          }
          if (delivery_errors_counter >= 6) {
            $(document).triggerCustom('loading:fail:insales:deliveries');
          }
          if (delivery_errors_counter < 6) {
            debounced_deliveries();
          }
          return delivery_errors_counter++;
        }
      });
    };
    get_deferred_payments = function() {
      return payments_request = get_payments();
    };
    get_payments = function() {
      $(document).triggerCustom('loading:insales:payments');
      return $.ajax({
        url: "/payment/for_order.json?v2=" + ($('[data-checkout2]').length > 0),
        type: 'PUT',
        dataType: 'json',
        data: $('#order_form').formSerialize(),
        timeout: 10000,
        success: function(data) {
          payment_errors_counter = 0;
          $(document).triggerCustom('loaded:insales:order', data.order);
          return $(document).triggerCustom('loaded:insales:payments', data.payments);
        },
        error: function(xhr, status, error_thrown) {
          if (status !== 'error' && status !== 'timeout') {
            return;
          }
          if (payment_errors_counter >= 6) {
            $(document).triggerCustom('loading:fail:insales:payments');
          }
          if (payment_errors_counter < 6) {
            debounced_payments();
          }
          return payment_errors_counter++;
        }
      });
    };
    disable_element = function(element) {
      if ($(element).data('deliveryId')) {
        return $(element).triggerCustom('disable:insales:delivery');
      } else {
        return $(element).triggerCustom('disable:insales:payment');
      }
    };
    enable_element = function(element) {
      if ($(element).data('deliveryId')) {
        return $(element).triggerCustom('enable:insales:delivery');
      } else {
        return $(element).triggerCustom('enable:insales:payment');
      }
    };
    debounced_payments = $.debounce(800, false, get_deferred_payments);
    debounced_deliveries = $.debounce(1000, false, get_deferred_deliveries);
    set_deliveries_query = function() {
      return debounced_deliveries();
    };
    $(function() {
      $(document).on('changed:insales:discounts', function() {
        return get_payments();
      });
      $(document).on('loading:insales:payments', function() {
        if (payments_request && payments_request.readyState !== 4) {
          return payments_request.abort();
        }
      });
      $(document).on('loading:insales:deliveries', function() {
        if (deliveries_request && deliveries_request.readyState !== 4) {
          return deliveries_request.abort();
        }
      });
      $(document).on('click', '[data-onepage-checkout] #delivery_variants :radio', function() {
        if ($(this).closest('.co-input-wrapper').hasClass('not_available')) {
          return false;
        }
        $(this).attr('checked', 'checked');
        return debounced_payments();
      });
      $(document).on('calc_delivery', function() {});
      $(document).on('click', '[data-onepage-checkout] #payment_gateways :radio', function() {
        if ($(this).closest('.co-input-wrapper').hasClass('not_available')) {
          return false;
        }
        return $(this).attr('checked', 'checked');
      });
      $(document).on('change', '[data-onepage-checkout] #shipping_address_address', debounced_deliveries);
      $(document).on('change', '[data-onepage-checkout] #delivery_address', debounced_deliveries);
      $(document).on('change', '[data-onepage-checkout] #shipping_address select', debounced_deliveries);
      $(document).on('keyup', '[data-onepage-checkout] #shipping_address_city', debounced_deliveries);
      $(document).on('paste', '[data-onepage-checkout] #shipping_address_city', debounced_deliveries);
      $(document).on('cut', '[data-onepage-checkout] #shipping_address_city', debounced_deliveries);
      $(document).on('typeahead:selected.address-autocomplete typeahead:autocompleted.address-autocomplete cleaned.address-autocomplete', '[data-onepage-checkout]', debounced_deliveries);
      $(document).on('change', '[data-onepage-checkout] #shipping_address_zip', debounced_deliveries);
      $(document).on('change', '[data-onepage-checkout] input[name*="manual_index"]', debounced_deliveries);
      $(document).on('change', '[data-onepage-checkout] #shipping_address_no_delivery', function() {
        checkout_common.no_delivery($('#shipping_address_no_delivery'));
        if ($('[data-checkout2]').length > 0) {
          return;
        }
        return debounced_deliveries();
      });
      if ($('[data-onepage-checkout]').length > 0 && $('[data-checkout2]').length === 0) {
        checkout_common.no_delivery($('#shipping_address_no_delivery'));
        debounced_deliveries();
      }
      if ($('[data-checkout2]').length > 0) {
        return debounced_deliveries();
      }
    });
    return {
      get_deferred_deliveries: get_deferred_deliveries,
      get_deliveries: get_deliveries,
      get_deferred_payments: get_deferred_payments,
      get_payments: get_payments,
      disable_element: disable_element,
      enable_element: enable_element,
      debounced_payments: debounced_payments,
      debounced_deliveries: debounced_deliveries,
      set_deliveries_query: set_deliveries_query
    };
  });

}).call(this);
/*
 * Facebox (for jQuery)
 * version: 1.2 (05/05/2008)
 * @requires jQuery v1.2 or later
 *
 * Examples at http://famspam.com/facebox/
 *
 * Licensed under the MIT:
 *   http://www.opensource.org/licenses/mit-license.php
 *
 * Copyright 2007, 2008 Chris Wanstrath [ chris@ozmm.org ]
 *
 * Usage:
 *
 *  jQuery(document).ready(function() {
 *    jQuery('a[rel*=facebox]').facebox()
 *  })
 *
 *  <a href="#terms" rel="facebox">Terms</a>
 *    Loads the #terms div in the box
 *
 *  <a href="terms.html" rel="facebox">Terms</a>
 *    Loads the terms.html page in the box
 *
 *  <a href="terms.png" rel="facebox">Terms</a>
 *    Loads the terms.png image in the box
 *
 *
 *  You can also use it programmatically:
 *
 *    jQuery.facebox('some html')
 *
 *  The above will open a facebox with "some html" as the content.
 *
 *    jQuery.facebox(function($) {
 *      $.get('blah.html', function(data) { $.facebox(data) })
 *    })
 *
 *  The above will show a loading screen before the passed function is called,
 *  allowing for a better ajaxy experience.
 *
 *  The facebox function can also display an ajax page or image:
 *
 *    jQuery.facebox({ ajax: 'remote.html' })
 *    jQuery.facebox({ image: 'dude.jpg' })
 *
 *  Want to close the facebox?  Trigger the 'close.facebox' document event:
 *
 *    jQuery(document).trigger('close.facebox')
 *
 *  Facebox also has a bunch of other hooks:
 *
 *    loading.facebox
 *    beforeReveal.facebox
 *    reveal.facebox (aliased as 'afterReveal.facebox')
 *    init.facebox
 *
 *  Simply bind a function to any of these hooks:
 *
 *   $(document).bind('reveal.facebox', function() { ...stuff to do after the facebox and contents are revealed... })
 *
 */


(function(module){
if (typeof(define) == 'function' && define.amd) {
  define('facebox', ['jquery'], module);
} else {
  module(window.jQuery);
}})(function($) {
  $.facebox = function(data, klass) {
    $.facebox.loading()

    if (data.ajax) fillFaceboxFromAjax(data.ajax,klass)
    else if (data.image) fillFaceboxFromImage(data.image,klass)
    else if (data.div) fillFaceboxFromHref(data.div,klass)
    else if ($.isFunction(data)) data.call($)
    else $.facebox.reveal(data, klass)
  }

  /*
   * Public, $.facebox methods
   */

  $.extend($.facebox, {
    settings: {
      opacity      : 0,
      overlay      : true,
      loadingImage : '/served_assets/facebox/loading.gif',
      closeImage   : '/served_assets/facebox/closelabel%locale%.gif',
      imageTypes   : [ 'png', 'jpg', 'jpeg', 'gif' ],
      faceboxHtml  : '\
    <div id="facebox" style="display:none;"> \
      <div class="popup"> \
        <table> \
          <tbody> \
            <tr> \
              <td class="tl"/><td class="b"/><td class="tr"/> \
            </tr> \
            <tr> \
              <td class="b"/> \
              <td class="body"> \
                <div class="content_fb"> \
                </div> \
                <div class="fb_footer"> \
                  <a href="#" class="close"> \
                    <img src="/served_assets/facebox/closelabel.gif" title="close" class="close_image" /> \
                  </a> \
                </div> \
              </td> \
              <td class="b"/> \
            </tr> \
            <tr> \
              <td class="bl"/><td class="b"/><td class="br"/> \
            </tr> \
          </tbody> \
        </table> \
      </div> \
    </div>'
    },

    loading: function() {
      init()
      if ($('#facebox .loading').length == 1) return true
      showOverlay()

      $('#facebox .content_fb').empty()
      $('#facebox .body').children().hide().end().
        append('<div class="loading"><img src="'+$.facebox.settings.loadingImage+'"/></div>')

      $('#facebox').css({
        top:	getPageScroll()[1] + (getPageHeight() / 10),
        left:	385.5
      }).show()

      $(document).bind('keydown.facebox', function(e) {
        if (e.keyCode == 27) $.facebox.close()
        return true
      })
      $(document).trigger('loading.facebox')
    },

    reveal: function(data, klass) {
      $(document).trigger('beforeReveal.facebox')
      if (klass) $('#facebox .content_fb').addClass(klass)
      $('#facebox .content_fb').append(data)
      $('#facebox .loading').remove()
      $('#facebox .body').children().fadeIn('normal')
      $('#facebox').css('left', $(window).width() / 2 - ($('#facebox table').width() / 2))
      $(document).trigger('reveal.facebox').trigger('afterReveal.facebox')
    },

    close: function() {
      $(document).trigger('close.facebox')
      return false
    }
  })

  /*
   * Public, $.fn methods
   */

  $.fn.facebox = function(settings) {
    init(settings)

    function clickHandler() {
      $.facebox.loading(true)

      // support for rel="facebox.inline_popup" syntax, to add a class
      // also supports deprecated "facebox[.inline_popup]" syntax
      var klass = this.rel.match(/facebox\[?\.(\w+)\]?/)
      if (klass) klass = klass[1]

      fillFaceboxFromHref(this.href, klass)
      return false
    }

    return this.click(clickHandler)
  }

  /*
   * Private methods
   */

  // called one time to setup facebox on this page
  function init(settings) {
    if ($.facebox.settings.inited) return true
    else $.facebox.settings.inited = true

    $(document).trigger('init.facebox')
    makeCompatible()

    var imageTypes = $.facebox.settings.imageTypes.join('|')
    $.facebox.settings.imageTypesRegexp = new RegExp('\.' + imageTypes + '$', 'i')

    if (settings) $.extend($.facebox.settings, settings)
    $('body').append($.facebox.settings.faceboxHtml)

    var preload = [ new Image(), new Image() ]
    var locale = ''
    if (typeof(I18n) != "undefined") {
      locale = '_' + I18n.locale
    }

    preload[0].src = $.facebox.settings.closeImage.replace(/%locale%/, locale)
    preload[1].src = $.facebox.settings.loadingImage

    $('#facebox').find('.b:first, .bl, .br, .tl, .tr').each(function() {
      preload.push(new Image())
      preload.slice(-1).src = $(this).css('background-image').replace(/url\((.+)\)/, '$1')
    })

    $('#facebox .close').click($.facebox.close)
    $('#facebox .close_image').attr('src', $.facebox.settings.closeImage.replace(/%locale%/, locale))
  }

  // getPageScroll() by quirksmode.com
  function getPageScroll() {
    var xScroll, yScroll;
    if (self.pageYOffset) {
      yScroll = self.pageYOffset;
      xScroll = self.pageXOffset;
    } else if (document.documentElement && document.documentElement.scrollTop) {   // Explorer 6 Strict
      yScroll = document.documentElement.scrollTop;
      xScroll = document.documentElement.scrollLeft;
    } else if (document.body) {// all other Explorers
      yScroll = document.body.scrollTop;
      xScroll = document.body.scrollLeft;
    }
    return new Array(xScroll,yScroll)
  }

  // Adapted from getPageSize() by quirksmode.com
  function getPageHeight() {
    var windowHeight
    if (self.innerHeight) {	// all except Explorer
      windowHeight = self.innerHeight;
    } else if (document.documentElement && document.documentElement.clientHeight) { // Explorer 6 Strict Mode
      windowHeight = document.documentElement.clientHeight;
    } else if (document.body) { // other Explorers
      windowHeight = document.body.clientHeight;
    }
    return windowHeight
  }

  // Backwards compatibility
  function makeCompatible() {
    var $s = $.facebox.settings

    $s.loadingImage = $s.loading_image || $s.loadingImage
    $s.closeImage = $s.close_image || $s.closeImage
    $s.imageTypes = $s.image_types || $s.imageTypes
    $s.faceboxHtml = $s.facebox_html || $s.faceboxHtml
  }

  // Figures out what you want to display and displays it
  // formats are:
  //     div: #id
  //   image: blah.extension
  //    ajax: anything else
  function fillFaceboxFromHref(href, klass) {
    // div
    if (href.match(/#/)) {
      var url    = window.location.href.split('#')[0]
      var target = href.replace(url,'')
      $.facebox.reveal($(target).clone().show(), klass)

    // image
    } else if (href.match($.facebox.settings.imageTypesRegexp)) {
      fillFaceboxFromImage(href, klass)
    // ajax
    } else {
      fillFaceboxFromAjax(href, klass)
    }
  }

  function fillFaceboxFromImage(href, klass) {
    var image = new Image()
    image.onload = function() {
      $.facebox.reveal('<div class="image"><img src="' + image.src + '" /></div>', klass)
    }
    image.src = href
  }

  function fillFaceboxFromAjax(href, klass) {
    $.get(href, function(data) { $.facebox.reveal(data, klass) })
  }

  function skipOverlay() {
    return $.facebox.settings.overlay == false || $.facebox.settings.opacity === null
  }

  function showOverlay() {
    if (skipOverlay()) return

    if ($('facebox_overlay').length == 0)
      $("body").append('<div id="facebox_overlay" class="facebox_hide"></div>')

    $('#facebox_overlay').hide().addClass("facebox_overlayBG")
      .css('opacity', $.facebox.settings.opacity)
      .click(function() { $(document).trigger('close.facebox') })
      .fadeIn(200)
    return false
  }

  function hideOverlay() {
    if (skipOverlay()) return

    $('#facebox_overlay').fadeOut(200, function(){
      $("#facebox_overlay").removeClass("facebox_overlayBG")
      $("#facebox_overlay").addClass("facebox_hide")
      $("#facebox_overlay").remove()
    })

    return false
  }

  /*
   * Bindings
   */

  $(document).bind('close.facebox', function() {
    $(document).unbind('keydown.facebox')
    $('#facebox').fadeOut(function() {
      $('#facebox .content_fb').removeClass().addClass('content_fb')
      hideOverlay()
      $('#facebox .loading').remove()
    })
  })

});
/*! Copyright (c) 2013 Brandon Aaron (http://brandonaaron.net)
 * Licensed under the MIT License (LICENSE.txt).
 *
 * Version 3.0.0
 */


(function (factory) {
    if (typeof define === 'function' && define.amd) {
        // AMD. Register as an anonymous module.
        define('jquery.bgiframe', ['jquery'], factory);
    } else {
        // Browser globals
        factory(jQuery);
    }
}(function ($) {
    $.fn.bgiframe = function(s) {
        s = $.extend({
            top         : 'auto', // auto == borderTopWidth
            left        : 'auto', // auto == borderLeftWidth
            width       : 'auto', // auto == offsetWidth
            height      : 'auto', // auto == offsetHeight
            opacity     : true,
            src         : 'javascript:false;',
            conditional : /MSIE 6.0/.test(navigator.userAgent) // expresion or function. return false to prevent iframe insertion
        }, s);

        // wrap conditional in a function if it isn't already
        if (!$.isFunction(s.conditional)) {
            var condition = s.conditional;
            s.conditional = function() { return condition; };
        }

        var $iframe = $('<iframe class="bgiframe"frameborder="0"tabindex="-1"src="'+s.src+'"'+
                           'style="display:block;position:absolute;z-index:-1;"/>');

        return this.each(function() {
            var $this = $(this);
            if ( s.conditional(this) === false ) { return; }
            var existing = $this.children('iframe.bgiframe');
            var $el = existing.length === 0 ? $iframe.clone() : existing;
            $el.css({
                'top': s.top == 'auto' ?
                    ((parseInt($this.css('borderTopWidth'),10)||0)*-1)+'px' : prop(s.top),
                'left': s.left == 'auto' ?
                    ((parseInt($this.css('borderLeftWidth'),10)||0)*-1)+'px' : prop(s.left),
                'width': s.width == 'auto' ? (this.offsetWidth + 'px') : prop(s.width),
                'height': s.height == 'auto' ? (this.offsetHeight + 'px') : prop(s.height),
                'opacity': s.opacity === true ? 0 : undefined
            });

            if ( existing.length === 0 ) {
                $this.prepend($el);
            }
        });
    };

    // old alias
    $.fn.bgIframe = $.fn.bgiframe;

    function prop(n) {
        return n && n.constructor === Number ? n + 'px' : n;
    }

}));
(function() {
  define('shop/checkout_init', ['jquery', 'jquery.form', 'jquery.ba-throttle-debounce', 'jquery.bgiframe', 'facebox', 'shop/checkout/checkout', 'shop/checkout/address', 'shop/checkout/recipient', 'shop/checkout/delivery', 'shop/checkout_delivery_backward_compatibility', 'shop/checkout/payment_gateway', 'shop/external_delivery', 'shop/external_delivery_v2', 'shop/pick_point', 'shop/pick_up', 'shop/pick_up_maps/factory', 'shop/pick_up_maps/map_yandex', 'shop/pick_up_maps/map_google', 'shop/onepage_checkout'], function($) {
    return $(function() {
      if ($('[data-order]').length > 0) {
        $(document).triggerCustom('loaded:insales:order', $('[data-order]').data('order'));
      }
      if ($('[data-step-delivery]').length > 0) {
        $(document).triggerCustom('loaded:insales:deliveries', $('[data-delivery-variants]').data('delivery-variants'));
      }
      if ($('[data-selected-delivery]').length > 0) {
        $(document).triggerCustom('selected:insales:delivery', $('[data-selected-delivery]').data('selected-delivery'));
      }
      if ($('[data-step-payment]').length > 0) {
        return $(document).triggerCustom('loaded:insales:payments', $('[data-payment-gateways]').data('payment-gateways'));
      }
    });
  });

}).call(this);
(function() {
  define('shop/bank_bills', ['jquery'], function($) {
    return $(function() {
      var $form, call_back, original_action;
      if (!$('#get_pdf_receipt, #print_receipt, #get_pdf_receipt_kz').length) {
        return;
      }
      $form = $('#form');
      original_action = $form.attr('action');
      call_back = function(e) {
        var input;
        $('*[data-render-type]').remove();
        input = $("<input>").attr("type", "hidden").attr("data-render-type", "true").attr("name", this).val("bla");
        $form.append($(input));
        return $form.attr('action', $(e.currentTarget).attr('formaction')).submit().attr('action', original_action);
      };
      $('#get_pdf_receipt').click(call_back.bind("pdf"));
      $('#print_receipt').click(call_back.bind("html"));
      return $('#get_pdf_receipt_kz').click(call_back.bind("pdf"));
    });
  });

}).call(this);
(function() {
  var indexOf = [].indexOf || function(item) { for (var i = 0, l = this.length; i < l; i++) { if (i in this && this[i] === item) return i; } return -1; };

  define('shop/check_redefined', ['jquery'], function($) {
    var checkRedefined, checkRedefinedOnLoad, doSwitchJs;
    doSwitchJs = function(redefined, switchJs) {
      return $.ajax({
        url: '/switch_js.json',
        type: 'POST',
        contentType: 'application/json',
        data: JSON.stringify({
          redefined_api_methods: redefined,
          switch_js: switchJs
        })
      });
    };
    checkRedefined = function(base, switchJs, names) {
      var $meta, alreadyKnown, k, name, redefined;
      if (!navigator.userAgent.match(/AppleWebKit/)) {
        return;
      }
      $meta = $('meta[name="insales-redefined-api-methods"]');
      if (!$meta.length) {
        return;
      }
      if (!(names != null ? names.length : void 0)) {
        names = (function() {
          var results;
          results = [];
          for (k in base) {
            if (typeof base[k] === 'function') {
              results.push(k);
            }
          }
          return results;
        })();
      }
      alreadyKnown = (function() {
        try {
          return JSON.parse($meta.attr('content'));
        } catch (error) {
          return [];
        }
      })();
      redefined = (function() {
        var i, len, results;
        results = [];
        for (i = 0, len = names.length; i < len; i++) {
          name = names[i];
          if (window[name] !== base[name] && (switchJs || indexOf.call(alreadyKnown, name) < 0)) {
            results.push(name);
          }
        }
        return results;
      })();
      if (redefined.length) {
        console.log('>>> methods redefined:', redefined);
        return doSwitchJs(redefined, switchJs);
      }
    };
    checkRedefinedOnLoad = function(base, switchJs, names) {
      return $(function() {
        return checkRedefined(base, switchJs, names);
      });
    };
    return {
      checkRedefined: checkRedefined,
      checkRedefinedOnLoad: checkRedefinedOnLoad
    };
  });

}).call(this);
(function() {
  var extend = function(child, parent) { for (var key in parent) { if (hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; },
    hasProp = {}.hasOwnProperty;

  define('shop/export_api', ['jquery', 'shop/check_redefined'], function($, arg) {
    var checkRedefinedOnLoad, exportApi, exportItems, exportJQuery, guesExportAs, prepareExport, setIn;
    checkRedefinedOnLoad = arg.checkRedefinedOnLoad;
    guesExportAs = function(item) {
      return typeof item;
    };
    prepareExport = function(item, exportAs) {
      if (exportAs == null) {
        exportAs = guesExportAs(item);
      }
      switch (exportAs) {
        case 'function':
          return item;
        case 'object':
          return $.extend(true, {}, item);
        case 'class':
          return (function(superClass) {
            extend(_Class, superClass);

            function _Class() {
              return _Class.__super__.constructor.apply(this, arguments);
            }

            return _Class;

          })(item);
        case 'const':
          return item;
      }
    };
    setIn = function(target, key, value) {
      var current, i, k, lastKey, len;
      if (typeof key === 'string') {
        key = key.split('.');
      }
      lastKey = key.pop();
      current = target;
      for (i = 0, len = key.length; i < len; i++) {
        k = key[i];
        if (current[k] == null) {
          current[k] = {};
        }
        current = current[k];
      }
      return current[lastKey] = value;
    };
    exportItems = function(items, exportAs) {
      var item, key;
      for (key in items) {
        item = items[key];
        setIn(window, key, prepareExport(item, exportAs));
      }
      return void 0;
    };
    exportApi = function() {
      var InSales, checkout, checkoutDelivery, onepageCheckout, pickPoint, utils;
      InSales = require('shop/public/insales');
      exportItems({
        'InSales.formatMoney': InSales.formatMoney,
        'InSales.isDefined': InSales.isDefined
      }, 'function');
      exportItems({
        'InSales.QueryString': InSales.QueryString
      }, 'object');
      exportItems({
        'InSales.Cart': InSales.Cart,
        'InSales.Compare': InSales.Compare,
        'InSales.OptionSelectors': InSales.OptionSelectors,
        'InSales.OrderLine': InSales.OrderLine,
        'InSales.Product': InSales.Product,
        'InSales.SingleOptionSelector': InSales.SingleOptionSelector
      }, 'class');
      utils = require('shop/public/utils');
      exportItems(utils, 'function');
      checkRedefinedOnLoad(utils, true, ['addOrderItem', 'initAjaxAddToCartButton']);
      pickPoint = require('shop/pick_point');
      exportItems(pickPoint, 'const');
      checkout = require('shop/checkout/checkout');
      exportItems({
        no_delivery: checkout.no_delivery,
        set_message: checkout.set_message
      }, 'function');
      onepageCheckout = require('shop/onepage_checkout');
      exportItems(onepageCheckout, 'function');
      checkoutDelivery = require('shop/checkout_delivery_backward_compatibility');
      return exportItems(checkoutDelivery, 'const');
    };
    exportJQuery = function() {
      var newJq, rootnewJq;
      newJq = function(selector, context) {
        return new newJq.fn.init(selector, context, rootnewJq);
      };
      $.extend(true, newJq, $);
      newJq.fn = newJq.prototype = $.extend({}, $.prototype);
      newJq.fn.init.prototype = newJq.prototype;
      rootnewJq = newJq(document);
      return window.jQuery = window.$ = newJq;
    };
    return {
      exportApi: exportApi,
      exportJQuery: exportJQuery
    };
  });

}).call(this);
(function() {
  $('head').prepend("<style>\n  .fc.old-theme-fix {\n    overflow: visible;\n  }\n  .fc.old-theme-fix:after {\n    clear: both;\n    display: block;\n    content: '';\n  }\n  .tt-dropdown-menu {\n    max-height: 300px;\n    overflow-y: auto;\n    min-width: 160px;\n    margin-top: 2px;\n    padding: 5px 5px;\n    background-color: #ffffff;\n    border: 1px solid #cccccc;\n    border: 1px solid rgba(0, 0, 0, 0.15);\n    border-radius: 4px;\n    -webkit-box-shadow: 0 6px 12px rgba(0, 0, 0, 0.175);\n          box-shadow: 0 6px 12px rgba(0, 0, 0, 0.175);\n    background-clip: padding-box;\n\n  }\n  .twitter-typeahead {\n    display: inherit !important;\n  }\n  .twitter-typeahead .tt-query, .twitter-typeahead .tt-hint {\n    margin-bottom: 0;\n  }\n  .tt-suggestion, .tt-footer {\n    display: block;\n    padding: 1px 0px 1px 10px;\n  }\n  .tt-suggestion.tt-is-under-cursor, .tt-footer.tt-is-under-cursor {\n    color: #fff;\n    background-color: #428bca;\n  }\n  .tt-suggestion.tt-is-under-cursor a, .tt-footer.tt-is-under-cursor a {\n    color: #fff;\n  }\n  .tt-suggestion.tt-cursor, .tt-footer.tt-cursor {\n    color: #fff;\n    background-color: #428bca;\n  }\n  .tt-suggestion p, .tt-footer p {\n    margin: 0;\n  }\n</style>");

}).call(this);
/*!
 * typeahead.js 0.10.5
 * https://github.com/twitter/typeahead.js
 * Copyright 2013-2018 Twitter, Inc. and other contributors; Licensed MIT
 */


(function($) {
    var _ = function() {
        "use strict";
        return {
            isMsie: function() {
                return /(msie|trident)/i.test(navigator.userAgent) ? navigator.userAgent.match(/(msie |rv:)(\d+(.\d+)?)/i)[2] : false;
            },
            isBlankString: function(str) {
                return !str || /^\s*$/.test(str);
            },
            escapeRegExChars: function(str) {
                return str.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&");
            },
            isString: function(obj) {
                return typeof obj === "string";
            },
            isNumber: function(obj) {
                return typeof obj === "number";
            },
            isArray: $.isArray,
            isFunction: $.isFunction,
            isObject: $.isPlainObject,
            isUndefined: function(obj) {
                return typeof obj === "undefined";
            },
            toStr: function toStr(s) {
                return _.isUndefined(s) || s === null ? "" : s + "";
            },
            bind: $.proxy,
            each: function(collection, cb) {
                $.each(collection, reverseArgs);
                function reverseArgs(index, value) {
                    return cb(value, index);
                }
            },
            map: $.map,
            filter: $.grep,
            every: function(obj, test) {
                var result = true;
                if (!obj) {
                    return result;
                }
                $.each(obj, function(key, val) {
                    if (!(result = test.call(null, val, key, obj))) {
                        return false;
                    }
                });
                return !!result;
            },
            some: function(obj, test) {
                var result = false;
                if (!obj) {
                    return result;
                }
                $.each(obj, function(key, val) {
                    if (result = test.call(null, val, key, obj)) {
                        return false;
                    }
                });
                return !!result;
            },
            mixin: $.extend,
            getUniqueId: function() {
                var counter = 0;
                return function() {
                    return counter++;
                };
            }(),
            templatify: function templatify(obj) {
                return $.isFunction(obj) ? obj : template;
                function template() {
                    return String(obj);
                }
            },
            defer: function(fn) {
                setTimeout(fn, 0);
            },
            debounce: function(func, wait, immediate) {
                var timeout, result;
                return function() {
                    var context = this, args = arguments, later, callNow;
                    later = function() {
                        timeout = null;
                        if (!immediate) {
                            result = func.apply(context, args);
                        }
                    };
                    callNow = immediate && !timeout;
                    clearTimeout(timeout);
                    timeout = setTimeout(later, wait);
                    if (callNow) {
                        result = func.apply(context, args);
                    }
                    return result;
                };
            },
            throttle: function(func, wait) {
                var context, args, timeout, result, previous, later;
                previous = 0;
                later = function() {
                    previous = new Date();
                    timeout = null;
                    result = func.apply(context, args);
                };
                return function() {
                    var now = new Date(), remaining = wait - (now - previous);
                    context = this;
                    args = arguments;
                    if (remaining <= 0) {
                        clearTimeout(timeout);
                        timeout = null;
                        previous = now;
                        result = func.apply(context, args);
                    } else if (!timeout) {
                        timeout = setTimeout(later, remaining);
                    }
                    return result;
                };
            },
            noop: function() {}
        };
    }();
    var html = function() {
        return {
            wrapper: '<span class="twitter-typeahead"></span>',
            dropdown: '<span class="tt-dropdown-menu"></span>',
            dataset: '<div class="tt-dataset-%CLASS%"></div>',
            suggestions: '<span class="tt-suggestions"></span>',
            suggestion: '<div class="tt-suggestion"></div>'
        };
    }();
    var css = function() {
        "use strict";
        var css = {
            wrapper: {
                position: "relative",
                display: "inline-block"
            },
            hint: {
                position: "absolute",
                top: "0",
                left: "0",
                borderColor: "transparent",
                boxShadow: "none",
                opacity: "1"
            },
            input: {
                position: "relative",
                verticalAlign: "top",
                backgroundColor: "transparent"
            },
            inputWithNoHint: {
                position: "relative",
                verticalAlign: "top"
            },
            dropdown: {
                position: "absolute",
                top: "100%",
                left: "0",
                zIndex: "100",
                display: "none"
            },
            suggestions: {
                display: "block"
            },
            suggestion: {
                whiteSpace: "nowrap",
                cursor: "pointer"
            },
            suggestionChild: {
                whiteSpace: "normal"
            },
            ltr: {
                left: "0",
                right: "auto"
            },
            rtl: {
                left: "auto",
                right: " 0"
            }
        };
        if (_.isMsie()) {
            _.mixin(css.input, {
                backgroundImage: "url(data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7)"
            });
        }
        if (_.isMsie() && _.isMsie() <= 7) {
            _.mixin(css.input, {
                marginTop: "-1px"
            });
        }
        return css;
    }();
    var EventBus = function() {
        "use strict";
        var namespace = "typeahead:";
        function EventBus(o) {
            if (!o || !o.el) {
                $.error("EventBus initialized without el");
            }
            this.$el = $(o.el);
        }
        _.mixin(EventBus.prototype, {
            trigger: function(type) {
                var args = [].slice.call(arguments, 1);
                this.$el.trigger(namespace + type, args);
            }
        });
        return EventBus;
    }();
    var EventEmitter = function() {
        "use strict";
        var splitter = /\s+/, nextTick = getNextTick();
        return {
            onSync: onSync,
            onAsync: onAsync,
            off: off,
            trigger: trigger
        };
        function on(method, types, cb, context) {
            var type;
            if (!cb) {
                return this;
            }
            types = types.split(splitter);
            cb = context ? bindContext(cb, context) : cb;
            this._callbacks = this._callbacks || {};
            while (type = types.shift()) {
                this._callbacks[type] = this._callbacks[type] || {
                    sync: [],
                    async: []
                };
                this._callbacks[type][method].push(cb);
            }
            return this;
        }
        function onAsync(types, cb, context) {
            return on.call(this, "async", types, cb, context);
        }
        function onSync(types, cb, context) {
            return on.call(this, "sync", types, cb, context);
        }
        function off(types) {
            var type;
            if (!this._callbacks) {
                return this;
            }
            types = types.split(splitter);
            while (type = types.shift()) {
                delete this._callbacks[type];
            }
            return this;
        }
        function trigger(types) {
            var type, callbacks, args, syncFlush, asyncFlush;
            if (!this._callbacks) {
                return this;
            }
            types = types.split(splitter);
            args = [].slice.call(arguments, 1);
            while ((type = types.shift()) && (callbacks = this._callbacks[type])) {
                syncFlush = getFlush(callbacks.sync, this, [ type ].concat(args));
                asyncFlush = getFlush(callbacks.async, this, [ type ].concat(args));
                syncFlush() && nextTick(asyncFlush);
            }
            return this;
        }
        function getFlush(callbacks, context, args) {
            return flush;
            function flush() {
                var cancelled;
                for (var i = 0, len = callbacks.length; !cancelled && i < len; i += 1) {
                    cancelled = callbacks[i].apply(context, args) === false;
                }
                return !cancelled;
            }
        }
        function getNextTick() {
            var nextTickFn;
            if (window.setImmediate) {
                nextTickFn = function nextTickSetImmediate(fn) {
                    setImmediate(function() {
                        fn();
                    });
                };
            } else {
                nextTickFn = function nextTickSetTimeout(fn) {
                    setTimeout(function() {
                        fn();
                    }, 0);
                };
            }
            return nextTickFn;
        }
        function bindContext(fn, context) {
            return fn.bind ? fn.bind(context) : function() {
                fn.apply(context, [].slice.call(arguments, 0));
            };
        }
    }();
    var highlight = function(doc) {
        "use strict";
        var defaults = {
            node: null,
            pattern: null,
            tagName: "strong",
            className: null,
            wordsOnly: false,
            caseSensitive: false
        };
        return function hightlight(o) {
            var regex;
            o = _.mixin({}, defaults, o);
            if (!o.node || !o.pattern) {
                return;
            }
            o.pattern = _.isArray(o.pattern) ? o.pattern : [ o.pattern ];
            regex = getRegex(o.pattern, o.caseSensitive, o.wordsOnly);
            traverse(o.node, hightlightTextNode);
            function hightlightTextNode(textNode) {
                var match, patternNode, wrapperNode;
                if (match = regex.exec(textNode.data)) {
                    wrapperNode = doc.createElement(o.tagName);
                    o.className && (wrapperNode.className = o.className);
                    patternNode = textNode.splitText(match.index);
                    patternNode.splitText(match[0].length);
                    wrapperNode.appendChild(patternNode.cloneNode(true));
                    textNode.parentNode.replaceChild(wrapperNode, patternNode);
                }
                return !!match;
            }
            function traverse(el, hightlightTextNode) {
                var childNode, TEXT_NODE_TYPE = 3;
                for (var i = 0; i < el.childNodes.length; i++) {
                    childNode = el.childNodes[i];
                    if (childNode.nodeType === TEXT_NODE_TYPE) {
                        i += hightlightTextNode(childNode) ? 1 : 0;
                    } else {
                        traverse(childNode, hightlightTextNode);
                    }
                }
            }
        };
        function getRegex(patterns, caseSensitive, wordsOnly) {
            var escapedPatterns = [], regexStr;
            for (var i = 0, len = patterns.length; i < len; i++) {
                escapedPatterns.push(_.escapeRegExChars(patterns[i]));
            }
            regexStr = wordsOnly ? "\\b(" + escapedPatterns.join("|") + ")\\b" : "(" + escapedPatterns.join("|") + ")";
            return caseSensitive ? new RegExp(regexStr) : new RegExp(regexStr, "i");
        }
    }(window.document);
    var Input = function() {
        "use strict";
        var specialKeyCodeMap;
        specialKeyCodeMap = {
            9: "tab",
            27: "esc",
            37: "left",
            39: "right",
            13: "enter",
            38: "up",
            40: "down"
        };
        function Input(o) {
            var that = this, onBlur, onFocus, onKeydown, onInput;
            o = o || {};
            if (!o.input) {
                $.error("input is missing");
            }
            onBlur = _.bind(this._onBlur, this);
            onFocus = _.bind(this._onFocus, this);
            onKeydown = _.bind(this._onKeydown, this);
            onInput = _.bind(this._onInput, this);
            this.$hint = $(o.hint);
            this.$input = $(o.input).on("blur.tt", onBlur).on("focus.tt", onFocus).on("keydown.tt", onKeydown);
            if (this.$hint.length === 0) {
                this.setHint = this.getHint = this.clearHint = this.clearHintIfInvalid = _.noop;
            }
            if (!_.isMsie()) {
                this.$input.on("input.tt", onInput);
            } else {
                this.$input.on("keydown.tt keypress.tt cut.tt paste.tt", function($e) {
                    if (specialKeyCodeMap[$e.which || $e.keyCode]) {
                        return;
                    }
                    _.defer(_.bind(that._onInput, that, $e));
                });
            }
            this.query = this.$input.val();
            this.$overflowHelper = buildOverflowHelper(this.$input);
        }
        Input.normalizeQuery = function(str) {
            return (str || "").replace(/^\s*/g, "").replace(/\s{2,}/g, " ");
        };
        _.mixin(Input.prototype, EventEmitter, {
            _onBlur: function onBlur() {
                this.resetInputValue();
                this.trigger("blurred");
            },
            _onFocus: function onFocus() {
                this.trigger("focused");
            },
            _onKeydown: function onKeydown($e) {
                var keyName = specialKeyCodeMap[$e.which || $e.keyCode];
                this._managePreventDefault(keyName, $e);
                if (keyName && this._shouldTrigger(keyName, $e)) {
                    this.trigger(keyName + "Keyed", $e);
                }
            },
            _onInput: function onInput() {
                this._checkInputValue();
            },
            _managePreventDefault: function managePreventDefault(keyName, $e) {
                var preventDefault, hintValue, inputValue;
                switch (keyName) {
                  case "tab":
                    hintValue = this.getHint();
                    inputValue = this.getInputValue();
                    preventDefault = hintValue && hintValue !== inputValue && !withModifier($e);
                    break;

                  case "up":
                  case "down":
                    preventDefault = !withModifier($e);
                    break;

                  default:
                    preventDefault = false;
                }
                preventDefault && $e.preventDefault();
            },
            _shouldTrigger: function shouldTrigger(keyName, $e) {
                var trigger;
                switch (keyName) {
                  case "tab":
                    trigger = !withModifier($e);
                    break;

                  default:
                    trigger = true;
                }
                return trigger;
            },
            _checkInputValue: function checkInputValue() {
                var inputValue, areEquivalent, hasDifferentWhitespace;
                inputValue = this.getInputValue();
                areEquivalent = areQueriesEquivalent(inputValue, this.query);
                hasDifferentWhitespace = areEquivalent ? this.query.length !== inputValue.length : false;
                this.query = inputValue;
                if (!areEquivalent) {
                    this.trigger("queryChanged", this.query);
                } else if (hasDifferentWhitespace) {
                    this.trigger("whitespaceChanged", this.query);
                }
            },
            focus: function focus() {
                this.$input.focus();
            },
            blur: function blur() {
                this.$input.blur();
            },
            getQuery: function getQuery() {
                return this.query;
            },
            setQuery: function setQuery(query) {
                this.query = query;
            },
            getInputValue: function getInputValue() {
                return this.$input.val();
            },
            setInputValue: function setInputValue(value, silent) {
                this.$input.val(value);
                silent ? this.clearHint() : this._checkInputValue();
            },
            resetInputValue: function resetInputValue() {
                this.setInputValue(this.query, true);
            },
            getHint: function getHint() {
                return this.$hint.val();
            },
            setHint: function setHint(value) {
                this.$hint.val(value);
            },
            clearHint: function clearHint() {
                this.setHint("");
            },
            clearHintIfInvalid: function clearHintIfInvalid() {
                var val, hint, valIsPrefixOfHint, isValid;
                val = this.getInputValue();
                hint = this.getHint();
                valIsPrefixOfHint = val !== hint && hint.indexOf(val) === 0;
                isValid = val !== "" && valIsPrefixOfHint && !this.hasOverflow();
                !isValid && this.clearHint();
            },
            getLanguageDirection: function getLanguageDirection() {
                return (this.$input.css("direction") || "ltr").toLowerCase();
            },
            hasOverflow: function hasOverflow() {
                var constraint = this.$input.width() - 2;
                this.$overflowHelper.show();
                this.$overflowHelper.text(this.getInputValue());
                var hasOverflow = this.$overflowHelper.width() >= constraint;
                this.$overflowHelper.hide();
            },
            isCursorAtEnd: function() {
                var valueLength, selectionStart, range;
                valueLength = this.$input.val().length;
                selectionStart = this.$input[0].selectionStart;
                if (_.isNumber(selectionStart)) {
                    return selectionStart === valueLength;
                } else if (document.selection) {
                    range = document.selection.createRange();
                    range.moveStart("character", -valueLength);
                    return valueLength === range.text.length;
                }
                return true;
            },
            destroy: function destroy() {
                this.$hint.off(".tt");
                this.$input.off(".tt");
                this.$hint = this.$input = this.$overflowHelper = null;
            }
        });
        return Input;
        function buildOverflowHelper($input) {
            return $('<pre aria-hidden="true"></pre>').css({
                position: "absolute",
                visibility: "hidden",
                whiteSpace: "pre",
                fontFamily: $input.css("font-family"),
                fontSize: $input.css("font-size"),
                fontStyle: $input.css("font-style"),
                fontVariant: $input.css("font-variant"),
                fontWeight: $input.css("font-weight"),
                wordSpacing: $input.css("word-spacing"),
                letterSpacing: $input.css("letter-spacing"),
                textIndent: $input.css("text-indent"),
                textRendering: $input.css("text-rendering"),
                textTransform: $input.css("text-transform")
            }).insertAfter($input);
        }
        function areQueriesEquivalent(a, b) {
            return Input.normalizeQuery(a) === Input.normalizeQuery(b);
        }
        function withModifier($e) {
            return $e.altKey || $e.ctrlKey || $e.metaKey || $e.shiftKey;
        }
    }();
    var Dataset = function() {
        "use strict";
        var datasetKey = "ttDataset", valueKey = "ttValue", datumKey = "ttDatum";
        function Dataset(o) {
            o = o || {};
            o.templates = o.templates || {};
            if (!o.source) {
                $.error("missing source");
            }
            if (o.name && !isValidName(o.name)) {
                $.error("invalid dataset name: " + o.name);
            }
            this.query = null;
            this.highlight = !!o.highlight;
            this.name = o.name || _.getUniqueId();
            this.source = o.source;
            this.displayFn = getDisplayFn(o.display || o.displayKey);
            this.templates = getTemplates(o.templates, this.displayFn);
            this.$el = $(html.dataset.replace("%CLASS%", this.name));
        }
        Dataset.extractDatasetName = function extractDatasetName(el) {
            return $(el).data(datasetKey);
        };
        Dataset.extractValue = function extractDatum(el) {
            return $(el).data(valueKey);
        };
        Dataset.extractDatum = function extractDatum(el) {
            return $(el).data(datumKey);
        };
        _.mixin(Dataset.prototype, EventEmitter, {
            _render: function render(query, suggestions) {
                if (!this.$el) {
                    return;
                }
                var that = this, hasSuggestions;
                this.$el.empty();
                hasSuggestions = suggestions && suggestions.length;
                if (!hasSuggestions && this.templates.empty) {
                    this.$el.html(getEmptyHtml()).prepend(that.templates.header ? getHeaderHtml() : null).append(that.templates.footer ? getFooterHtml() : null);
                } else if (hasSuggestions) {
                    this.$el.html(getSuggestionsHtml()).prepend(that.templates.header ? getHeaderHtml() : null).append(that.templates.footer ? getFooterHtml() : null);
                }
                this.trigger("rendered");
                function getEmptyHtml() {
                    return that.templates.empty({
                        query: query,
                        isEmpty: true
                    });
                }
                function getSuggestionsHtml() {
                    var $suggestions, nodes;
                    $suggestions = $(html.suggestions).css(css.suggestions);
                    nodes = _.map(suggestions, getSuggestionNode);
                    $suggestions.append.apply($suggestions, nodes);
                    that.highlight && highlight({
                        className: "tt-highlight",
                        node: $suggestions[0],
                        pattern: query
                    });
                    return $suggestions;
                    function getSuggestionNode(suggestion) {
                        var $el;
                        $el = $(html.suggestion).append(that.templates.suggestion(suggestion)).data(datasetKey, that.name).data(valueKey, that.displayFn(suggestion)).data(datumKey, suggestion);
                        $el.children().each(function() {
                            $(this).css(css.suggestionChild);
                        });
                        return $el;
                    }
                }
                function getHeaderHtml() {
                    return that.templates.header({
                        query: query,
                        isEmpty: !hasSuggestions
                    });
                }
                function getFooterHtml() {
                    return that.templates.footer({
                        query: query,
                        isEmpty: !hasSuggestions
                    });
                }
            },
            getRoot: function getRoot() {
                return this.$el;
            },
            update: function update(query) {
                var that = this;
                this.query = query;
                this.canceled = false;
                this.source(query, render);
                function render(suggestions) {
                    if (!that.canceled && query === that.query) {
                        that._render(query, suggestions);
                    }
                }
            },
            cancel: function cancel() {
                this.canceled = true;
            },
            clear: function clear() {
                this.cancel();
                this.$el.empty();
                this.trigger("rendered");
            },
            isEmpty: function isEmpty() {
                return this.$el.is(":empty");
            },
            destroy: function destroy() {
                this.$el = null;
            }
        });
        return Dataset;
        function getDisplayFn(display) {
            display = display || "value";
            return _.isFunction(display) ? display : displayFn;
            function displayFn(obj) {
                return obj[display];
            }
        }
        function getTemplates(templates, displayFn) {
            return {
                empty: templates.empty && _.templatify(templates.empty),
                header: templates.header && _.templatify(templates.header),
                footer: templates.footer && _.templatify(templates.footer),
                suggestion: templates.suggestion || suggestionTemplate
            };
            function suggestionTemplate(context) {
                return "<p>" + displayFn(context) + "</p>";
            }
        }
        function isValidName(str) {
            return /^[_a-zA-Z0-9-]+$/.test(str);
        }
    }();
    var Dropdown = function() {
        "use strict";
        function Dropdown(o) {
            var that = this, onSuggestionClick, onSuggestionMouseEnter, onSuggestionMouseLeave;
            o = o || {};
            if (!o.menu) {
                $.error("menu is required");
            }
            this.isOpen = false;
            this.isEmpty = true;
            this.datasets = _.map(o.datasets, initializeDataset);
            onSuggestionClick = _.bind(this._onSuggestionClick, this);
            onSuggestionMouseEnter = _.bind(this._onSuggestionMouseEnter, this);
            onSuggestionMouseLeave = _.bind(this._onSuggestionMouseLeave, this);
            this.$menu = $(o.menu).on("click.tt", ".tt-suggestion", onSuggestionClick).on("mouseenter.tt", ".tt-suggestion", onSuggestionMouseEnter).on("mouseleave.tt", ".tt-suggestion", onSuggestionMouseLeave);
            _.each(this.datasets, function(dataset) {
                that.$menu.append(dataset.getRoot());
                dataset.onSync("rendered", that._onRendered, that);
            });
        }
        _.mixin(Dropdown.prototype, EventEmitter, {
            _onSuggestionClick: function onSuggestionClick($e) {
                this.trigger("suggestionClicked", $($e.currentTarget));
            },
            _onSuggestionMouseEnter: function onSuggestionMouseEnter($e) {
                this._removeCursor();
                this._setCursor($($e.currentTarget), true);
            },
            _onSuggestionMouseLeave: function onSuggestionMouseLeave() {
                this._removeCursor();
            },
            _onRendered: function onRendered() {
                this.isEmpty = _.every(this.datasets, isDatasetEmpty);
                this.isEmpty ? this._hide() : this.isOpen && this._show();
                this.trigger("datasetRendered");
                function isDatasetEmpty(dataset) {
                    return dataset.isEmpty();
                }
            },
            _hide: function() {
                this.$menu.hide();
            },
            _show: function() {
                this.$menu.css("display", "block");
            },
            _getSuggestions: function getSuggestions() {
                return this.$menu.find(".tt-suggestion");
            },
            _getCursor: function getCursor() {
                return this.$menu.find(".tt-cursor").first();
            },
            _setCursor: function setCursor($el, silent) {
                $el.first().addClass("tt-cursor");
                !silent && this.trigger("cursorMoved");
            },
            _removeCursor: function removeCursor() {
                this._getCursor().removeClass("tt-cursor");
            },
            _moveCursor: function moveCursor(increment) {
                var $suggestions, $oldCursor, newCursorIndex, $newCursor;
                if (!this.isOpen) {
                    return;
                }
                $oldCursor = this._getCursor();
                $suggestions = this._getSuggestions();
                this._removeCursor();
                newCursorIndex = $suggestions.index($oldCursor) + increment;
                newCursorIndex = (newCursorIndex + 1) % ($suggestions.length + 1) - 1;
                if (newCursorIndex === -1) {
                    this.trigger("cursorRemoved");
                    return;
                } else if (newCursorIndex < -1) {
                    newCursorIndex = $suggestions.length - 1;
                }
                this._setCursor($newCursor = $suggestions.eq(newCursorIndex));
                this._ensureVisible($newCursor);
            },
            _ensureVisible: function ensureVisible($el) {
                var elTop, elBottom, menuScrollTop, menuHeight;
                elTop = $el.position().top;
                elBottom = elTop + $el.outerHeight(true);
                menuScrollTop = this.$menu.scrollTop();
                menuHeight = this.$menu.height() + parseInt(this.$menu.css("paddingTop"), 10) + parseInt(this.$menu.css("paddingBottom"), 10);
                if (elTop < 0) {
                    this.$menu.scrollTop(menuScrollTop + elTop);
                } else if (menuHeight < elBottom) {
                    this.$menu.scrollTop(menuScrollTop + (elBottom - menuHeight));
                }
            },
            close: function close() {
                if (this.isOpen) {
                    this.isOpen = false;
                    this._removeCursor();
                    this._hide();
                    this.trigger("closed");
                }
            },
            open: function open() {
                if (!this.isOpen) {
                    this.isOpen = true;
                    !this.isEmpty && this._show();
                    this.trigger("opened");
                }
            },
            setLanguageDirection: function setLanguageDirection(dir) {
                this.$menu.css(dir === "ltr" ? css.ltr : css.rtl);
            },
            moveCursorUp: function moveCursorUp() {
                this._moveCursor(-1);
            },
            moveCursorDown: function moveCursorDown() {
                this._moveCursor(+1);
            },
            getDatumForSuggestion: function getDatumForSuggestion($el) {
                var datum = null;
                if ($el.length) {
                    datum = {
                        raw: Dataset.extractDatum($el),
                        value: Dataset.extractValue($el),
                        datasetName: Dataset.extractDatasetName($el)
                    };
                }
                return datum;
            },
            getDatumForCursor: function getDatumForCursor() {
                return this.getDatumForSuggestion(this._getCursor().first());
            },
            getDatumForTopSuggestion: function getDatumForTopSuggestion() {
                return this.getDatumForSuggestion(this._getSuggestions().first());
            },
            update: function update(query) {
                _.each(this.datasets, updateDataset);
                function updateDataset(dataset) {
                    dataset.update(query);
                }
            },
            empty: function empty() {
                _.each(this.datasets, clearDataset);
                this.isEmpty = true;
                function clearDataset(dataset) {
                    dataset.clear();
                }
            },
            isVisible: function isVisible() {
                return this.isOpen && !this.isEmpty;
            },
            destroy: function destroy() {
                this.$menu.off(".tt");
                this.$menu = null;
                _.each(this.datasets, destroyDataset);
                function destroyDataset(dataset) {
                    dataset.destroy();
                }
            }
        });
        return Dropdown;
        function initializeDataset(oDataset) {
            return new Dataset(oDataset);
        }
    }();
    var Typeahead = function() {
        "use strict";
        var attrsKey = "ttAttrs";
        function Typeahead(o) {
            var $menu, $input, $hint;
            o = o || {};
            if (!o.input) {
                $.error("missing input");
            }
            this.isActivated = false;
            this.autoselect = !!o.autoselect;
            this.minLength = _.isNumber(o.minLength) ? o.minLength : 1;
            this.$node = buildDom(o.input, o.withHint);
            $menu = this.$node.find(".tt-dropdown-menu");
            $input = this.$node.find(".tt-input");
            $hint = this.$node.find(".tt-hint");
            $input.on("blur.tt", function($e) {
                var active, isActive, hasActive;
                active = document.activeElement;
                isActive = $menu.is(active);
                hasActive = $menu.has(active).length > 0;
                if (_.isMsie() && (isActive || hasActive)) {
                    $e.preventDefault();
                    $e.stopImmediatePropagation();
                    _.defer(function() {
                        $input.focus();
                    });
                }
            });
            $menu.on("mousedown.tt", function($e) {
                $e.preventDefault();
            });
            this.eventBus = o.eventBus || new EventBus({
                el: $input
            });
            this.dropdown = new Dropdown({
                menu: $menu,
                datasets: o.datasets
            }).onSync("suggestionClicked", this._onSuggestionClicked, this).onSync("cursorMoved", this._onCursorMoved, this).onSync("cursorRemoved", this._onCursorRemoved, this).onSync("opened", this._onOpened, this).onSync("closed", this._onClosed, this).onAsync("datasetRendered", this._onDatasetRendered, this);
            this.input = new Input({
                input: $input,
                hint: $hint
            }).onSync("focused", this._onFocused, this).onSync("blurred", this._onBlurred, this).onSync("enterKeyed", this._onEnterKeyed, this).onSync("tabKeyed", this._onTabKeyed, this).onSync("escKeyed", this._onEscKeyed, this).onSync("upKeyed", this._onUpKeyed, this).onSync("downKeyed", this._onDownKeyed, this).onSync("leftKeyed", this._onLeftKeyed, this).onSync("rightKeyed", this._onRightKeyed, this).onSync("queryChanged", this._onQueryChanged, this).onSync("whitespaceChanged", this._onWhitespaceChanged, this);
            this._setLanguageDirection();
        }
        _.mixin(Typeahead.prototype, {
            _onSuggestionClicked: function onSuggestionClicked(type, $el) {
                var datum;
                if (datum = this.dropdown.getDatumForSuggestion($el)) {
                    this._select(datum);
                }
            },
            _onCursorMoved: function onCursorMoved() {
                var datum = this.dropdown.getDatumForCursor();
                this.input.setInputValue(datum.value, true);
                this.eventBus.trigger("cursorchanged", datum.raw, datum.datasetName);
            },
            _onCursorRemoved: function onCursorRemoved() {
                this.input.resetInputValue();
                this._updateHint();
            },
            _onDatasetRendered: function onDatasetRendered() {
                this._updateHint();
            },
            _onOpened: function onOpened() {
                this._updateHint();
                this.eventBus.trigger("opened");
            },
            _onClosed: function onClosed() {
                this.input.clearHint();
                this.eventBus.trigger("closed");
            },
            _onFocused: function onFocused() {
                this.isActivated = true;
                this.dropdown.open();
            },
            _onBlurred: function onBlurred() {
                this.isActivated = false;
                this.dropdown.empty();
                this.dropdown.close();
            },
            _onEnterKeyed: function onEnterKeyed(type, $e) {
                var cursorDatum, topSuggestionDatum;
                cursorDatum = this.dropdown.getDatumForCursor();
                topSuggestionDatum = this.dropdown.getDatumForTopSuggestion();
                if (cursorDatum) {
                    this._select(cursorDatum);
                    $e.preventDefault();
                } else if (this.autoselect && topSuggestionDatum) {
                    this._select(topSuggestionDatum);
                    $e.preventDefault();
                }
            },
            _onTabKeyed: function onTabKeyed(type, $e) {
                var datum;
                if (datum = this.dropdown.getDatumForCursor()) {
                    this._select(datum);
                    $e.preventDefault();
                } else {
                    this._autocomplete(true);
                }
            },
            _onEscKeyed: function onEscKeyed() {
                this.dropdown.close();
                this.input.resetInputValue();
            },
            _onUpKeyed: function onUpKeyed() {
                var query = this.input.getQuery();
                this.dropdown.isEmpty && query.length >= this.minLength ? this.dropdown.update(query) : this.dropdown.moveCursorUp();
                this.dropdown.open();
            },
            _onDownKeyed: function onDownKeyed() {
                var query = this.input.getQuery();
                this.dropdown.isEmpty && query.length >= this.minLength ? this.dropdown.update(query) : this.dropdown.moveCursorDown();
                this.dropdown.open();
            },
            _onLeftKeyed: function onLeftKeyed() {
                this.dir === "rtl" && this._autocomplete();
            },
            _onRightKeyed: function onRightKeyed() {
                this.dir === "ltr" && this._autocomplete();
            },
            _onQueryChanged: function onQueryChanged(e, query) {
                this.input.clearHintIfInvalid();
                query.length >= this.minLength ? this.dropdown.update(query) : this.dropdown.empty();
                this.dropdown.open();
                this._setLanguageDirection();
            },
            _onWhitespaceChanged: function onWhitespaceChanged() {
                this._updateHint();
                this.dropdown.open();
            },
            _setLanguageDirection: function setLanguageDirection() {
                var dir;
                if (this.dir !== (dir = this.input.getLanguageDirection())) {
                    this.dir = dir;
                    this.$node.css("direction", dir);
                    this.dropdown.setLanguageDirection(dir);
                }
            },
            _updateHint: function updateHint() {
                var datum, val, query, escapedQuery, frontMatchRegEx, match;
                datum = this.dropdown.getDatumForTopSuggestion();
                if (datum && this.dropdown.isVisible() && !this.input.hasOverflow()) {
                    val = this.input.getInputValue();
                    query = Input.normalizeQuery(val);
                    escapedQuery = _.escapeRegExChars(query);
                    frontMatchRegEx = new RegExp("^(?:" + escapedQuery + ")(.+$)", "i");
                    match = frontMatchRegEx.exec(datum.value);
                    match ? this.input.setHint(val + match[1]) : this.input.clearHint();
                } else {
                    this.input.clearHint();
                }
            },
            _autocomplete: function autocomplete(laxCursor) {
                var hint, query, isCursorAtEnd, datum;
                hint = this.input.getHint();
                query = this.input.getQuery();
                isCursorAtEnd = laxCursor || this.input.isCursorAtEnd();
                if (hint && query !== hint && isCursorAtEnd) {
                    datum = this.dropdown.getDatumForTopSuggestion();
                    datum && this.input.setInputValue(datum.value);
                    this.eventBus.trigger("autocompleted", datum.raw, datum.datasetName);
                }
            },
            _select: function select(datum) {
                this.input.setQuery(datum.value);
                this.input.setInputValue(datum.value, true);
                this._setLanguageDirection();
                this.eventBus.trigger("selected", datum.raw, datum.datasetName);
                this.dropdown.close();
                _.defer(_.bind(this.dropdown.empty, this.dropdown));
            },
            open: function open() {
                this.dropdown.open();
            },
            close: function close() {
                this.dropdown.close();
            },
            setVal: function setVal(val) {
                val = _.toStr(val);
                if (this.isActivated) {
                    this.input.setInputValue(val);
                } else {
                    this.input.setQuery(val);
                    this.input.setInputValue(val, true);
                }
                this._setLanguageDirection();
            },
            getVal: function getVal() {
                return this.input.getQuery();
            },
            destroy: function destroy() {
                this.input.destroy();
                this.dropdown.destroy();
                destroyDomStructure(this.$node);
                this.$node = null;
            }
        });
        return Typeahead;
        function buildDom(input, withHint) {
            var $input, $wrapper, $dropdown, $hint;
            $input = $(input);
            $wrapper = $(html.wrapper).css(css.wrapper);
            $dropdown = $(html.dropdown).css(css.dropdown);
            $hint = $input.clone().css(css.hint).css(getBackgroundStyles($input));
            $hint.val("").removeData().addClass("tt-hint").removeAttr("id name placeholder required").prop("readonly", true).attr({
                autocomplete: "off",
                spellcheck: "false",
                tabindex: -1
            });
            $input.data(attrsKey, {
                dir: $input.attr("dir"),
                autocomplete: $input.attr("autocomplete"),
                spellcheck: $input.attr("spellcheck"),
                style: $input.attr("style")
            });
            $input.addClass("tt-input").attr({
                autocomplete: "off",
                spellcheck: false
            }).css(withHint ? css.input : css.inputWithNoHint);
            try {
                !$input.attr("dir") && $input.attr("dir", "auto");
            } catch (e) {}
            return $input.wrap($wrapper).parent().prepend(withHint ? $hint : null).append($dropdown);
        }
        function getBackgroundStyles($el) {
            return {
                backgroundAttachment: $el.css("background-attachment"),
                backgroundClip: $el.css("background-clip"),
                backgroundColor: $el.css("background-color"),
                backgroundImage: $el.css("background-image"),
                backgroundOrigin: $el.css("background-origin"),
                backgroundPosition: $el.css("background-position"),
                backgroundRepeat: $el.css("background-repeat"),
                backgroundSize: $el.css("background-size")
            };
        }
        function destroyDomStructure($node) {
            var $input = $node.find(".tt-input");
            _.each($input.data(attrsKey), function(val, key) {
                _.isUndefined(val) ? $input.removeAttr(key) : $input.attr(key, val);
            });
            $input.detach().removeData(attrsKey).removeClass("tt-input").insertAfter($node);
            $node.remove();
        }
    }();
    (function() {
        "use strict";
        var old, typeaheadKey, methods;
        old = $.fn.typeahead;
        typeaheadKey = "ttTypeahead";
        methods = {
            initialize: function initialize(o, datasets) {
                datasets = _.isArray(datasets) ? datasets : [].slice.call(arguments, 1);
                o = o || {};
                return this.each(attach);
                function attach() {
                    var $input = $(this), eventBus, typeahead;
                    _.each(datasets, function(d) {
                        d.highlight = !!o.highlight;
                    });
                    typeahead = new Typeahead({
                        input: $input,
                        eventBus: eventBus = new EventBus({
                            el: $input
                        }),
                        withHint: _.isUndefined(o.hint) ? true : !!o.hint,
                        minLength: o.minLength,
                        autoselect: o.autoselect,
                        datasets: datasets
                    });
                    $input.data(typeaheadKey, typeahead);
                }
            },
            open: function open() {
                return this.each(openTypeahead);
                function openTypeahead() {
                    var $input = $(this), typeahead;
                    if (typeahead = $input.data(typeaheadKey)) {
                        typeahead.open();
                    }
                }
            },
            close: function close() {
                return this.each(closeTypeahead);
                function closeTypeahead() {
                    var $input = $(this), typeahead;
                    if (typeahead = $input.data(typeaheadKey)) {
                        typeahead.close();
                    }
                }
            },
            val: function val(newVal) {
                return !arguments.length ? getVal(this.first()) : this.each(setVal);
                function setVal() {
                    var $input = $(this), typeahead;
                    if (typeahead = $input.data(typeaheadKey)) {
                        typeahead.setVal(newVal);
                    }
                }
                function getVal($input) {
                    var typeahead, query;
                    if (typeahead = $input.data(typeaheadKey)) {
                        query = typeahead.getVal();
                    }
                    return query;
                }
            },
            destroy: function destroy() {
                return this.each(unattach);
                function unattach() {
                    var $input = $(this), typeahead;
                    if (typeahead = $input.data(typeaheadKey)) {
                        typeahead.destroy();
                        $input.removeData(typeaheadKey);
                    }
                }
            }
        };
        $.fn.typeahead = function(method) {
            var tts;
            if (methods[method] && method !== "initialize") {
                tts = this.filter(function() {
                    return !!$(this).data(typeaheadKey);
                });
                return methods[method].apply(tts, [].slice.call(arguments, 1));
            } else {
                return methods.initialize.apply(this, arguments);
            }
        };
        $.fn.typeahead.noConflict = function noConflict() {
            $.fn.typeahead = old;
            return this;
        };
    })();
})(window.jQuery);
/*!
 * typeahead.js 0.10.5
 * https://github.com/twitter/typeahead.js
 * Copyright 2013-2018 Twitter, Inc. and other contributors; Licensed MIT
 */


(function($) {
    var _ = function() {
        "use strict";
        return {
            isMsie: function() {
                return /(msie|trident)/i.test(navigator.userAgent) ? navigator.userAgent.match(/(msie |rv:)(\d+(.\d+)?)/i)[2] : false;
            },
            isBlankString: function(str) {
                return !str || /^\s*$/.test(str);
            },
            escapeRegExChars: function(str) {
                return str.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&");
            },
            isString: function(obj) {
                return typeof obj === "string";
            },
            isNumber: function(obj) {
                return typeof obj === "number";
            },
            isArray: $.isArray,
            isFunction: $.isFunction,
            isObject: $.isPlainObject,
            isUndefined: function(obj) {
                return typeof obj === "undefined";
            },
            toStr: function toStr(s) {
                return _.isUndefined(s) || s === null ? "" : s + "";
            },
            bind: $.proxy,
            each: function(collection, cb) {
                $.each(collection, reverseArgs);
                function reverseArgs(index, value) {
                    return cb(value, index);
                }
            },
            map: $.map,
            filter: $.grep,
            every: function(obj, test) {
                var result = true;
                if (!obj) {
                    return result;
                }
                $.each(obj, function(key, val) {
                    if (!(result = test.call(null, val, key, obj))) {
                        return false;
                    }
                });
                return !!result;
            },
            some: function(obj, test) {
                var result = false;
                if (!obj) {
                    return result;
                }
                $.each(obj, function(key, val) {
                    if (result = test.call(null, val, key, obj)) {
                        return false;
                    }
                });
                return !!result;
            },
            mixin: $.extend,
            getUniqueId: function() {
                var counter = 0;
                return function() {
                    return counter++;
                };
            }(),
            templatify: function templatify(obj) {
                return $.isFunction(obj) ? obj : template;
                function template() {
                    return String(obj);
                }
            },
            defer: function(fn) {
                setTimeout(fn, 0);
            },
            debounce: function(func, wait, immediate) {
                var timeout, result;
                return function() {
                    var context = this, args = arguments, later, callNow;
                    later = function() {
                        timeout = null;
                        if (!immediate) {
                            result = func.apply(context, args);
                        }
                    };
                    callNow = immediate && !timeout;
                    clearTimeout(timeout);
                    timeout = setTimeout(later, wait);
                    if (callNow) {
                        result = func.apply(context, args);
                    }
                    return result;
                };
            },
            throttle: function(func, wait) {
                var context, args, timeout, result, previous, later;
                previous = 0;
                later = function() {
                    previous = new Date();
                    timeout = null;
                    result = func.apply(context, args);
                };
                return function() {
                    var now = new Date(), remaining = wait - (now - previous);
                    context = this;
                    args = arguments;
                    if (remaining <= 0) {
                        clearTimeout(timeout);
                        timeout = null;
                        previous = now;
                        result = func.apply(context, args);
                    } else if (!timeout) {
                        timeout = setTimeout(later, remaining);
                    }
                    return result;
                };
            },
            noop: function() {}
        };
    }();
    var VERSION = "0.10.5";
    var tokenizers = function() {
        "use strict";
        return {
            nonword: nonword,
            whitespace: whitespace,
            obj: {
                nonword: getObjTokenizer(nonword),
                whitespace: getObjTokenizer(whitespace)
            }
        };
        function whitespace(str) {
            str = _.toStr(str);
            return str ? str.split(/\s+/) : [];
        }
        function nonword(str) {
            str = _.toStr(str);
            return str ? str.split(/\W+/) : [];
        }
        function getObjTokenizer(tokenizer) {
            return function setKey() {
                var args = [].slice.call(arguments, 0);
                return function tokenize(o) {
                    var tokens = [];
                    _.each(args, function(k) {
                        tokens = tokens.concat(tokenizer(_.toStr(o[k])));
                    });
                    return tokens;
                };
            };
        }
    }();
    var LruCache = function() {
        "use strict";
        function LruCache(maxSize) {
            this.maxSize = _.isNumber(maxSize) ? maxSize : 100;
            this.reset();
            if (this.maxSize <= 0) {
                this.set = this.get = $.noop;
            }
        }
        _.mixin(LruCache.prototype, {
            set: function set(key, val) {
                var tailItem = this.list.tail, node;
                if (this.size >= this.maxSize) {
                    this.list.remove(tailItem);
                    delete this.hash[tailItem.key];
                }
                if (node = this.hash[key]) {
                    node.val = val;
                    this.list.moveToFront(node);
                } else {
                    node = new Node(key, val);
                    this.list.add(node);
                    this.hash[key] = node;
                    this.size++;
                }
            },
            get: function get(key) {
                var node = this.hash[key];
                if (node) {
                    this.list.moveToFront(node);
                    return node.val;
                }
            },
            reset: function reset() {
                this.size = 0;
                this.hash = {};
                this.list = new List();
            }
        });
        function List() {
            this.head = this.tail = null;
        }
        _.mixin(List.prototype, {
            add: function add(node) {
                if (this.head) {
                    node.next = this.head;
                    this.head.prev = node;
                }
                this.head = node;
                this.tail = this.tail || node;
            },
            remove: function remove(node) {
                node.prev ? node.prev.next = node.next : this.head = node.next;
                node.next ? node.next.prev = node.prev : this.tail = node.prev;
            },
            moveToFront: function(node) {
                this.remove(node);
                this.add(node);
            }
        });
        function Node(key, val) {
            this.key = key;
            this.val = val;
            this.prev = this.next = null;
        }
        return LruCache;
    }();
    var PersistentStorage = function() {
        "use strict";
        var ls, methods;
        try {
            ls = window.localStorage;
            ls.setItem("~~~", "!");
            ls.removeItem("~~~");
        } catch (err) {
            ls = null;
        }
        function PersistentStorage(namespace) {
            this.prefix = [ "__", namespace, "__" ].join("");
            this.ttlKey = "__ttl__";
            this.keyMatcher = new RegExp("^" + _.escapeRegExChars(this.prefix));
        }
        if (ls && window.JSON) {
            methods = {
                _prefix: function(key) {
                    return this.prefix + key;
                },
                _ttlKey: function(key) {
                    return this._prefix(key) + this.ttlKey;
                },
                get: function(key) {
                    if (this.isExpired(key)) {
                        this.remove(key);
                    }
                    return decode(ls.getItem(this._prefix(key)));
                },
                set: function(key, val, ttl) {
                    if (_.isNumber(ttl)) {
                        ls.setItem(this._ttlKey(key), encode(now() + ttl));
                    } else {
                        ls.removeItem(this._ttlKey(key));
                    }
                    return ls.setItem(this._prefix(key), encode(val));
                },
                remove: function(key) {
                    ls.removeItem(this._ttlKey(key));
                    ls.removeItem(this._prefix(key));
                    return this;
                },
                clear: function() {
                    var i, key, keys = [], len = ls.length;
                    for (i = 0; i < len; i++) {
                        if ((key = ls.key(i)).match(this.keyMatcher)) {
                            keys.push(key.replace(this.keyMatcher, ""));
                        }
                    }
                    for (i = keys.length; i--; ) {
                        this.remove(keys[i]);
                    }
                    return this;
                },
                isExpired: function(key) {
                    var ttl = decode(ls.getItem(this._ttlKey(key)));
                    return _.isNumber(ttl) && now() > ttl ? true : false;
                }
            };
        } else {
            methods = {
                get: _.noop,
                set: _.noop,
                remove: _.noop,
                clear: _.noop,
                isExpired: _.noop
            };
        }
        _.mixin(PersistentStorage.prototype, methods);
        return PersistentStorage;
        function now() {
            return new Date().getTime();
        }
        function encode(val) {
            return JSON.stringify(_.isUndefined(val) ? null : val);
        }
        function decode(val) {
            return JSON.parse(val);
        }
    }();
    var Transport = function() {
        "use strict";
        var pendingRequestsCount = 0, pendingRequests = {}, maxPendingRequests = 6, sharedCache = new LruCache(10);
        function Transport(o) {
            o = o || {};
            this.cancelled = false;
            this.lastUrl = null;
            this._send = o.transport ? callbackToDeferred(o.transport) : $.ajax;
            this._get = o.rateLimiter ? o.rateLimiter(this._get) : this._get;
            this._cache = o.cache === false ? new LruCache(0) : sharedCache;
        }
        Transport.setMaxPendingRequests = function setMaxPendingRequests(num) {
            maxPendingRequests = num;
        };
        Transport.resetCache = function resetCache() {
            sharedCache.reset();
        };
        _.mixin(Transport.prototype, {
            _get: function(url, o, cb) {
                var that = this, jqXhr;
                if (this.cancelled || url !== this.lastUrl) {
                    return;
                }
                if (jqXhr = pendingRequests[url]) {
                    jqXhr.done(done).fail(fail);
                } else if (pendingRequestsCount < maxPendingRequests) {
                    pendingRequestsCount++;
                    pendingRequests[url] = this._send(url, o).done(done).fail(fail).always(always);
                } else {
                    this.onDeckRequestArgs = [].slice.call(arguments, 0);
                }
                function done(resp) {
                    cb && cb(null, resp);
                    that._cache.set(url, resp);
                }
                function fail() {
                    cb && cb(true);
                }
                function always() {
                    pendingRequestsCount--;
                    delete pendingRequests[url];
                    if (that.onDeckRequestArgs) {
                        that._get.apply(that, that.onDeckRequestArgs);
                        that.onDeckRequestArgs = null;
                    }
                }
            },
            get: function(url, o, cb) {
                var resp;
                if (_.isFunction(o)) {
                    cb = o;
                    o = {};
                }
                this.cancelled = false;
                this.lastUrl = url;
                if (resp = this._cache.get(url)) {
                    _.defer(function() {
                        cb && cb(null, resp);
                    });
                } else {
                    this._get(url, o, cb);
                }
                return !!resp;
            },
            cancel: function() {
                this.cancelled = true;
            }
        });
        return Transport;
        function callbackToDeferred(fn) {
            return function customSendWrapper(url, o) {
                var deferred = $.Deferred();
                fn(url, o, onSuccess, onError);
                return deferred;
                function onSuccess(resp) {
                    _.defer(function() {
                        deferred.resolve(resp);
                    });
                }
                function onError(err) {
                    _.defer(function() {
                        deferred.reject(err);
                    });
                }
            };
        }
    }();
    var SearchIndex = function() {
        "use strict";
        function SearchIndex(o) {
            o = o || {};
            if (!o.datumTokenizer || !o.queryTokenizer) {
                $.error("datumTokenizer and queryTokenizer are both required");
            }
            this.datumTokenizer = o.datumTokenizer;
            this.queryTokenizer = o.queryTokenizer;
            this.reset();
        }
        _.mixin(SearchIndex.prototype, {
            bootstrap: function bootstrap(o) {
                this.datums = o.datums;
                this.trie = o.trie;
            },
            add: function(data) {
                var that = this;
                data = _.isArray(data) ? data : [ data ];
                _.each(data, function(datum) {
                    var id, tokens;
                    id = that.datums.push(datum) - 1;
                    tokens = normalizeTokens(that.datumTokenizer(datum));
                    _.each(tokens, function(token) {
                        var node, chars, ch;
                        node = that.trie;
                        chars = token.split("");
                        while (ch = chars.shift()) {
                            node = node.children[ch] || (node.children[ch] = newNode());
                            node.ids.push(id);
                        }
                    });
                });
            },
            get: function get(query) {
                var that = this, tokens, matches;
                tokens = normalizeTokens(this.queryTokenizer(query));
                _.each(tokens, function(token) {
                    var node, chars, ch, ids;
                    if (matches && matches.length === 0) {
                        return false;
                    }
                    node = that.trie;
                    chars = token.split("");
                    while (node && (ch = chars.shift())) {
                        node = node.children[ch];
                    }
                    if (node && chars.length === 0) {
                        ids = node.ids.slice(0);
                        matches = matches ? getIntersection(matches, ids) : ids;
                    } else {
                        matches = [];
                        return false;
                    }
                });
                return matches ? _.map(unique(matches), function(id) {
                    return that.datums[id];
                }) : [];
            },
            reset: function reset() {
                this.datums = [];
                this.trie = newNode();
            },
            serialize: function serialize() {
                return {
                    datums: this.datums,
                    trie: this.trie
                };
            }
        });
        return SearchIndex;
        function normalizeTokens(tokens) {
            tokens = _.filter(tokens, function(token) {
                return !!token;
            });
            tokens = _.map(tokens, function(token) {
                return token.toLowerCase();
            });
            return tokens;
        }
        function newNode() {
            return {
                ids: [],
                children: {}
            };
        }
        function unique(array) {
            var seen = {}, uniques = [];
            for (var i = 0, len = array.length; i < len; i++) {
                if (!seen[array[i]]) {
                    seen[array[i]] = true;
                    uniques.push(array[i]);
                }
            }
            return uniques;
        }
        function getIntersection(arrayA, arrayB) {
            var ai = 0, bi = 0, intersection = [];
            arrayA = arrayA.sort(compare);
            arrayB = arrayB.sort(compare);
            var lenArrayA = arrayA.length, lenArrayB = arrayB.length;
            while (ai < lenArrayA && bi < lenArrayB) {
                if (arrayA[ai] < arrayB[bi]) {
                    ai++;
                } else if (arrayA[ai] > arrayB[bi]) {
                    bi++;
                } else {
                    intersection.push(arrayA[ai]);
                    ai++;
                    bi++;
                }
            }
            return intersection;
            function compare(a, b) {
                return a - b;
            }
        }
    }();
    var oParser = function() {
        "use strict";
        return {
            local: getLocal,
            prefetch: getPrefetch,
            remote: getRemote
        };
        function getLocal(o) {
            return o.local || null;
        }
        function getPrefetch(o) {
            var prefetch, defaults;
            defaults = {
                url: null,
                thumbprint: "",
                ttl: 24 * 60 * 60 * 1e3,
                filter: null,
                ajax: {}
            };
            if (prefetch = o.prefetch || null) {
                prefetch = _.isString(prefetch) ? {
                    url: prefetch
                } : prefetch;
                prefetch = _.mixin(defaults, prefetch);
                prefetch.thumbprint = VERSION + prefetch.thumbprint;
                prefetch.ajax.type = prefetch.ajax.type || "GET";
                prefetch.ajax.dataType = prefetch.ajax.dataType || "json";
                !prefetch.url && $.error("prefetch requires url to be set");
            }
            return prefetch;
        }
        function getRemote(o) {
            var remote, defaults;
            defaults = {
                url: null,
                cache: true,
                wildcard: "%QUERY",
                replace: null,
                rateLimitBy: "debounce",
                rateLimitWait: 300,
                send: null,
                filter: null,
                ajax: {}
            };
            if (remote = o.remote || null) {
                remote = _.isString(remote) ? {
                    url: remote
                } : remote;
                remote = _.mixin(defaults, remote);
                remote.rateLimiter = /^throttle$/i.test(remote.rateLimitBy) ? byThrottle(remote.rateLimitWait) : byDebounce(remote.rateLimitWait);
                remote.ajax.type = remote.ajax.type || "GET";
                remote.ajax.dataType = remote.ajax.dataType || "json";
                delete remote.rateLimitBy;
                delete remote.rateLimitWait;
                !remote.url && $.error("remote requires url to be set");
            }
            return remote;
            function byDebounce(wait) {
                return function(fn) {
                    return _.debounce(fn, wait);
                };
            }
            function byThrottle(wait) {
                return function(fn) {
                    return _.throttle(fn, wait);
                };
            }
        }
    }();
    (function(root) {
        "use strict";
        var old, keys;
        old = root.Bloodhound;
        keys = {
            data: "data",
            protocol: "protocol",
            thumbprint: "thumbprint"
        };
        root.Bloodhound = Bloodhound;
        function Bloodhound(o) {
            if (!o || !o.local && !o.prefetch && !o.remote) {
                $.error("one of local, prefetch, or remote is required");
            }
            this.limit = o.limit || 5;
            this.sorter = getSorter(o.sorter);
            this.dupDetector = o.dupDetector || ignoreDuplicates;
            this.local = oParser.local(o);
            this.prefetch = oParser.prefetch(o);
            this.remote = oParser.remote(o);
            this.cacheKey = this.prefetch ? this.prefetch.cacheKey || this.prefetch.url : null;
            this.index = new SearchIndex({
                datumTokenizer: o.datumTokenizer,
                queryTokenizer: o.queryTokenizer
            });
            this.storage = this.cacheKey ? new PersistentStorage(this.cacheKey) : null;
        }
        Bloodhound.noConflict = function noConflict() {
            root.Bloodhound = old;
            return Bloodhound;
        };
        Bloodhound.tokenizers = tokenizers;
        _.mixin(Bloodhound.prototype, {
            _loadPrefetch: function loadPrefetch(o) {
                var that = this, serialized, deferred;
                if (serialized = this._readFromStorage(o.thumbprint)) {
                    this.index.bootstrap(serialized);
                    deferred = $.Deferred().resolve();
                } else {
                    deferred = $.ajax(o.url, o.ajax).done(handlePrefetchResponse);
                }
                return deferred;
                function handlePrefetchResponse(resp) {
                    that.clear();
                    that.add(o.filter ? o.filter(resp) : resp);
                    that._saveToStorage(that.index.serialize(), o.thumbprint, o.ttl);
                }
            },
            _getFromRemote: function getFromRemote(query, cb) {
                var that = this, url, uriEncodedQuery;
                if (!this.transport) {
                    return;
                }
                query = query || "";
                uriEncodedQuery = encodeURIComponent(query);
                url = this.remote.replace ? this.remote.replace(this.remote.url, query) : this.remote.url.replace(this.remote.wildcard, uriEncodedQuery);
                return this.transport.get(url, this.remote.ajax, handleRemoteResponse);
                function handleRemoteResponse(err, resp) {
                    err ? cb([]) : cb(that.remote.filter ? that.remote.filter(resp) : resp);
                }
            },
            _cancelLastRemoteRequest: function cancelLastRemoteRequest() {
                this.transport && this.transport.cancel();
            },
            _saveToStorage: function saveToStorage(data, thumbprint, ttl) {
                if (this.storage) {
                    this.storage.set(keys.data, data, ttl);
                    this.storage.set(keys.protocol, location.protocol, ttl);
                    this.storage.set(keys.thumbprint, thumbprint, ttl);
                }
            },
            _readFromStorage: function readFromStorage(thumbprint) {
                var stored = {}, isExpired;
                if (this.storage) {
                    stored.data = this.storage.get(keys.data);
                    stored.protocol = this.storage.get(keys.protocol);
                    stored.thumbprint = this.storage.get(keys.thumbprint);
                }
                isExpired = stored.thumbprint !== thumbprint || stored.protocol !== location.protocol;
                return stored.data && !isExpired ? stored.data : null;
            },
            _initialize: function initialize() {
                var that = this, local = this.local, deferred;
                deferred = this.prefetch ? this._loadPrefetch(this.prefetch) : $.Deferred().resolve();
                local && deferred.done(addLocalToIndex);
                this.transport = this.remote ? new Transport(this.remote) : null;
                return this.initPromise = deferred.promise();
                function addLocalToIndex() {
                    that.add(_.isFunction(local) ? local() : local);
                }
            },
            initialize: function initialize(force) {
                return !this.initPromise || force ? this._initialize() : this.initPromise;
            },
            add: function add(data) {
                this.index.add(data);
            },
            get: function get(query, cb) {
                var that = this, matches = [], cacheHit = false;
                matches = this.index.get(query);
                matches = this.sorter(matches).slice(0, this.limit);
                matches.length < this.limit ? cacheHit = this._getFromRemote(query, returnRemoteMatches) : this._cancelLastRemoteRequest();
                if (!cacheHit) {
                    (matches.length > 0 || !this.transport) && cb && cb(matches);
                }
                function returnRemoteMatches(remoteMatches) {
                    var matchesWithBackfill = matches.slice(0);
                    _.each(remoteMatches, function(remoteMatch) {
                        var isDuplicate;
                        isDuplicate = _.some(matchesWithBackfill, function(match) {
                            return that.dupDetector(remoteMatch, match);
                        });
                        !isDuplicate && matchesWithBackfill.push(remoteMatch);
                        return matchesWithBackfill.length < that.limit;
                    });
                    cb && cb(that.sorter(matchesWithBackfill));
                }
            },
            clear: function clear() {
                this.index.reset();
            },
            clearPrefetchCache: function clearPrefetchCache() {
                this.storage && this.storage.clear();
            },
            clearRemoteCache: function clearRemoteCache() {
                this.transport && Transport.resetCache();
            },
            ttAdapter: function ttAdapter() {
                return _.bind(this.get, this);
            }
        });
        return Bloodhound;
        function getSorter(sortFn) {
            return _.isFunction(sortFn) ? sort : noSort;
            function sort(array) {
                return array.sort(sortFn);
            }
            function noSort(array) {
                return array;
            }
        }
        function ignoreDuplicates() {
            return false;
        }
    })(this);
})(window.jQuery);
(function() {
  define('shop/address_autocomplete', ['jquery'], function($) {
    var AddressAutocomplete;
    $.fn.extend({
      addressAutocomplete: function(action, params) {
        return this.each(function() {
          var plugin;
          if (!(plugin = $(this).data('address-autocomplete-plugin'))) {
            plugin = new AddressAutocomplete($(this));
            $(this).data('address-autocomplete-plugin', plugin);
          }
          if (action) {
            return plugin[action](params);
          }
        });
      }
    });
    AddressAutocomplete = (function() {
      function AddressAutocomplete(element) {
        this.element = element;
        this.kladrHost = this.element.data('address-autocomplete');
        this.prefix = this.element.data('selector-prefix') || 'shipping_address';
        this.namePrefix = this.element.data('name-prefix') || 'shipping_address';
        this.countrySelector = "#" + this.prefix + "_country";
        this.stateSelector = "#" + this.prefix + "_state";
        this.citySelector = "#" + this.prefix + "_city";
        this.localitySelector = "#" + this.prefix + "_full_locality_name";
        this.kladrData = null;
        if (this.stateElement().is(':visible') || this.cityElement().is(':visible') || this.localityElement().is(':visible')) {
          this.setAddressData(this.element.data('address-json'));
        }
        this.bind();
      }

      AddressAutocomplete.prototype.start = function() {
        if (!this.started) {
          this.reinitState();
          this.reinitCity();
          this.reinitLocality();
          return this.started = true;
        }
      };

      AddressAutocomplete.prototype.countryElement = function() {
        return this.element.find(this.countrySelector);
      };

      AddressAutocomplete.prototype.stateElement = function() {
        return this.element.find(this.stateSelector);
      };

      AddressAutocomplete.prototype.cityElement = function() {
        return this.element.find(this.citySelector);
      };

      AddressAutocomplete.prototype.localityElement = function() {
        return this.element.find(this.localitySelector);
      };

      AddressAutocomplete.prototype.country = function() {
        return this.countryElement().val();
      };

      AddressAutocomplete.prototype.destroy = function() {
        this.unbind();
        this.stateElement().typeahead('destroy');
        this.cityElement().typeahead('destroy');
        return this.localityElement().typeahead('destroy');
      };

      AddressAutocomplete.prototype.bind = function() {
        this.unbind();
        this.countryElement().on('change.address-autocomplete', (function(_this) {
          return function() {
            _this.stateElement().val('');
            _this.cityElement().val('');
            _this.localityElement().val('');
            _this.setAddressData();
            _this.reinitState();
            _this.reinitCity();
            return _this.reinitLocality();
          };
        })(this));
        this.stateElement().on('typeahead:selected.address-autocomplete typeahead:autocompleted.address-autocomplete', (function(_this) {
          return function(e, data, set) {
            var defaultCity;
            defaultCity = '';
            if ((data != null ? data.city : void 0) && data.city.length > 0) {
              defaultCity = data.city;
            }
            _this.cityElement().typeahead('val', defaultCity);
            _this.reinitCity();
            return _this.setAddressData(data);
          };
        })(this));
        this.stateElement().on('keypress.address-autocomplete', (function(_this) {
          return function(e) {
            _this.setAddressData();
            return _this.stateChanged = true;
          };
        })(this));
        this.stateElement().on('keydown.address-autocomplete', (function(_this) {
          return function(e) {
            if (e.which === 8) {
              _this.setAddressData();
              return _this.stateChanged = true;
            }
          };
        })(this));
        this.stateElement().on('click.address-autocomplete', (function(_this) {
          return function(e) {
            var ev;
            ev = $.Event("keydown");
            ev.keyCode = ev.which = 40;
            $(e.currentTarget).trigger(ev);
            return true;
          };
        })(this));
        this.cityElement().on('typeahead:selected.address-autocomplete typeahead:autocompleted.address-autocomplete', (function(_this) {
          return function(e, data, set) {
            var cityState;
            cityState = '';
            if ((data != null ? data.state : void 0) && data.state.length > 0) {
              cityState = [data.state_type, data.state].filter(function(v) {
                return v && v !== '';
              }).join(" ");
            }
            if (cityState.length > 0) {
              _this.stateElement().typeahead('val', cityState);
              _this.stateChanged = true;
            }
            return _this.setAddressData(data);
          };
        })(this));
        this.cityElement().on('keypress.address-autocomplete', (function(_this) {
          return function(e) {
            return _this.setAddressData();
          };
        })(this));
        this.cityElement().on('keydown.address-autocomplete', (function(_this) {
          return function(e) {
            if (e.which === 8) {
              _this.setAddressData();
            }
            if (_this.stateChanged) {
              _this.stateChanged = false;
              return _this.reinitCity();
            }
          };
        })(this));
        this.cityElement().on('click.address-autocomplete', (function(_this) {
          return function(e) {
            if (_this.stateChanged) {
              _this.stateChanged = false;
              return _this.reinitCity();
            }
          };
        })(this));
        this.localityElement().on('typeahead:selected.address-autocomplete typeahead:autocompleted.address-autocomplete', (function(_this) {
          return function(e, data, set) {
            if (_this.country() === 'RU') {
              e.stopImmediatePropagation();
            }
            _this.localityChanged = false;
            _this.setAddressData(data);
            return _this.cleanAddress();
          };
        })(this));
        this.localityElement().on('change.address-autocomplete', (function(_this) {
          return function(e) {
            if (_this.localityChanged) {
              _this.localityChanged = false;
              _this.setAddressData();
              return _this.cleanAddress();
            }
          };
        })(this));
        this.localityElement().on('keypress.address-autocomplete', (function(_this) {
          return function(e) {
            return _this.localityChanged = true;
          };
        })(this));
        this.localityElement().on('keydown.address-autocomplete', (function(_this) {
          return function(e) {
            if (e.which === 8) {
              return _this.localityChanged = true;
            }
          };
        })(this));
        this.localityElement().on('paste.address-autocomplete cut.address-autocomplete', (function(_this) {
          return function(e) {
            _this.localityChanged = true;
            return _this.setAddressData();
          };
        })(this));
        return this.localityElement().on('click.address-autocomplete', (function(_this) {
          return function(e) {
            var ev;
            if (!_this.localityElement().closest('.twitter-typeahead').find('.tt-dropdown-menu').is(':visible')) {
              ev = $.Event("keydown");
              ev.keyCode = ev.which = 40;
              _this.localityElement().trigger(ev);
              return _this.localityElement().trigger(ev);
            }
          };
        })(this));
      };

      AddressAutocomplete.prototype.unbind = function() {
        this.countryElement().off('.address-autocomplete');
        this.stateElement().off('.address-autocomplete');
        return this.localityElement().off('.address-autocomplete');
      };

      AddressAutocomplete.prototype.updateLocality = function(data) {
        if (!this.started) {
          this.start();
        }
        this.setAddressData();
        this.localityElement().typeahead('val', data.result);
        this.stateElement().typeahead('val', data.state);
        this.cityElement().typeahead('val', data.settlement || data.city);
        this.cityElement().trigger('typeahead:selected.address-autocomplete', data);
        return this.localityElement().trigger('typeahead:selected.address-autocomplete', data);
      };

      AddressAutocomplete.prototype.cleanAddress = function(newAddress) {
        var address, ref;
        address = this.localityElement().val();
        if (newAddress) {
          address = newAddress;
        }
        if (address === '' || this.country() !== 'RU') {
          this.element.trigger('cleaned.address-autocomplete');
          return;
        }
        return $.ajax({
          url: this.kladrHost + "/clean/address.json?q=" + address + "&kladr_code=" + (((ref = this.kladrData) != null ? ref.code : void 0) || ''),
          dataType: 'jsonp',
          timeout: 2000
        }).done((function(_this) {
          return function(data) {
            var ref;
            if (((ref = _this.kladrData) != null ? ref.result : void 0) && (data != null ? data.result : void 0) && _this.kladrData.result !== data.result) {
              console.log('[Clean address error] selected address not equal parsed address');
              _this.element.trigger('cleaned.address-autocomplete');
              return;
            }
            if (data != null ? data.result : void 0) {
              _this.localityElement().typeahead('val', data.result);
              _this.setAddressData(data);
            }
            _this.setZipFied(data != null ? data.zip : void 0);
            console.log('cleaned.done');
            return _this.element.trigger('cleaned.address-autocomplete');
          };
        })(this)).fail((function(_this) {
          return function() {
            console.log('cleaned.fail');
            _this.setZipFied();
            return _this.element.trigger('cleaned.address-autocomplete');
          };
        })(this));
      };

      AddressAutocomplete.prototype.setZipFied = function(zip) {
        var $zipField;
        $zipField = $('#shipping_address_zip');
        if ($zipField.val() === '' || $zipField.prop('defaultValue') === $zipField.val()) {
          $zipField.val(zip || '');
          $zipField.prop('defaultValue', zip || '');
          if ($zipField.val() !== '') {
            return $zipField.closest('.co-input--text').removeClass('co-input--empty_nested');
          }
        }
      };

      AddressAutocomplete.prototype.setAddressData = function(data) {
        var inputValue;
        this.kladrData = data;
        this.shippingLocationElement().html('');
        inputValue = '';
        if (data) {
          inputValue = JSON.stringify($.extend({}, data, {
            is_kladr: true
          }));
        }
        return this.shippingLocationElement().append([$("<input type='hidden' name='" + this.namePrefix + "[kladr_json]'/>").val(inputValue)]);
      };

      AddressAutocomplete.prototype.shippingLocationElement = function() {
        this.locationElement = this.element.find('[data-shipping-location]');
        if (this.locationElement.length === 0) {
          this.locationElement = $("<div data-shipping-location style='display: none'></div>");
          this.element.prepend(this.locationElement);
        }
        return this.locationElement;
      };

      AddressAutocomplete.prototype.cityValue = function() {
        return this.cityElement().val() || '';
      };

      AddressAutocomplete.prototype.stateValue = function() {
        return this.stateElement().val() || '';
      };

      AddressAutocomplete.prototype.reinitState = function() {
        var ref, ref1, stateSource;
        if (this.stateElement().filter(':visible').length === 0) {
          return;
        }
        if ((ref = this.stateEngine) != null) {
          ref.clear();
        }
        if ((ref1 = this.stateEngine) != null) {
          ref1.clearPrefetchCache();
        }
        this.stateElement().typeahead('destroy');
        if (this.country() && $.inArray(this.country(), ['RU', 'KZ', 'UA', 'BY']) === -1) {
          return;
        }
        this.stateEngine = new Bloodhound({
          limit: 100,
          datumTokenizer: function(value) {
            if (value.last_level_type) {
              return [value.last_level_type, value.last_level];
            }
            return [value.last_level];
          },
          queryTokenizer: Bloodhound.tokenizers.whitespace,
          prefetch: {
            url: this.kladrHost + "/states.json?country=" + (this.country()),
            cacheKey: "v1_" + (this.country()),
            ajax: {
              dataType: 'jsonp'
            }
          }
        });
        this.stateEngine.initialize(true);
        stateSource = (function(_this) {
          return function(q, sync) {
            var i, len, ref2, v, values;
            if (q === '') {
              values = [];
              ref2 = _this.stateEngine.index.datums;
              for (i = 0, len = ref2.length; i < len; i++) {
                v = ref2[i];
                values.push(v);
              }
              return sync(values);
            } else {
              return _this.stateEngine.get(q, sync);
            }
          };
        })(this);
        this.stateElement().typeahead({
          minLength: 0,
          highlight: true,
          hint: true
        }, {
          source: stateSource,
          display: function(value) {
            return value.result;
          },
          templates: {
            empty: '<span class="empty-message">Регион не найден</span>'
          }
        });
        return this.stateElement().typeahead('val', this.stateElement().val());
      };

      AddressAutocomplete.prototype.reinitCity = function() {
        var citySource, ref, ref1;
        if (this.cityElement().filter(':visible').length === 0) {
          return;
        }
        if ((ref = this.cityEngine) != null) {
          ref.clear();
        }
        if ((ref1 = this.cityEngine) != null) {
          ref1.clearPrefetchCache();
        }
        this.cityElement().typeahead('destroy');
        if (this.country() && $.inArray(this.country(), ['RU', 'KZ', 'UA', 'BY']) === -1) {
          return;
        }
        this.cityEngine = new Bloodhound({
          limit: 50,
          datumTokenizer: function(d) {
            return Bloodhound.tokenizers.whitespace(d.last_level);
          },
          queryTokenizer: Bloodhound.tokenizers.whitespace,
          remote: {
            url: this.kladrHost + "/fulltext_search.json?country=" + (this.country()) + "&state=" + (this.stateValue()) + "&q=%QUERY",
            wildcard: '%QUERY',
            ajax: {
              dataType: 'jsonp'
            }
          }
        });
        this.cityEngine.initialize(true);
        citySource = (function(_this) {
          return function(q, sync) {
            var syncWithCompare;
            syncWithCompare = function(suggestions) {
              return sync(suggestions);
            };
            return _this.cityEngine.get(q, syncWithCompare);
          };
        })(this);
        this.cityElement().typeahead({
          minLength: 1,
          highlight: true,
          hint: true
        }, {
          source: citySource,
          display: function(value) {
            if (value.last_level === value.area && value.last_level_type) {
              return value.last_level + " " + value.last_level_type;
            }
            return value.last_level;
          },
          templates: {
            empty: '<span class="empty-message">Город не найден</span>',
            suggestion: function(value) {
              var last_level;
              last_level = value.last_level;
              if (value.last_level === value.area && value.last_level_type) {
                last_level = value.last_level + " " + value.last_level_type;
              }
              return "<div>" + last_level + "</br><small>" + value.result + "</small></div>";
            }
          }
        });
        return this.cityElement().typeahead('val', this.cityElement().val());
      };

      AddressAutocomplete.prototype.reinitLocality = function() {
        var localitySource, ref, ref1;
        if (this.localityElement().filter(':visible').length === 0) {
          return;
        }
        if ((ref = this.localityEngine) != null) {
          ref.clear();
        }
        if ((ref1 = this.localityEngine) != null) {
          ref1.clearPrefetchCache();
        }
        this.localityElement().typeahead('destroy');
        if (this.country() && $.inArray(this.country(), ['RU', 'KZ', 'UA', 'BY']) === -1) {
          return;
        }
        this.localityEngine = new Bloodhound({
          limit: 50,
          datumTokenizer: function(d) {
            return Bloodhound.tokenizers.whitespace(d.last_level);
          },
          queryTokenizer: Bloodhound.tokenizers.whitespace,
          remote: {
            url: this.kladrHost + "/fulltext_search.json?country=" + (this.country()) + "&with_parent=1&q=%QUERY",
            wildcard: '%QUERY',
            ajax: {
              dataType: 'jsonp'
            }
          }
        });
        this.localityEngine.initialize(true);
        localitySource = (function(_this) {
          return function(q, sync) {
            var syncWithCompare;
            syncWithCompare = function(suggestions) {
              return sync(suggestions);
            };
            return _this.localityEngine.get(q, syncWithCompare);
          };
        })(this);
        this.localityElement().typeahead({
          minLength: 1,
          highlight: true,
          hint: true
        }, {
          source: localitySource,
          display: function(value) {
            return value.result;
          },
          templates: {
            empty: '<span class="empty-message">Город не найден</span>',
            suggestion: function(value) {
              return "<div>" + value.result + "</div>";
            }
          }
        });
        return this.localityElement().typeahead('val', this.localityElement().val());
      };

      return AddressAutocomplete;

    })();
    $(function() {
      $(document).on('locality_changed.address-autocomplete', (function(_this) {
        return function(e, data) {
          return $('[data-address-autocomplete]').addressAutocomplete('updateLocality', data);
        };
      })(this));
      $(document).on('keydown click', '[data-address-autocomplete]', function(e) {
        var elementId;
        $('[data-address-autocomplete]').addressAutocomplete('start');
        elementId = $(e.target).attr('id');
        if (!("" + elementId).match('city|country|state|full_locality_name')) {
          return true;
        }
        $(e.target).focus();
        return $(e.target).attr('placeholder', '');
      });
      return $('[data-address-autocomplete]').addressAutocomplete();
    });
    return {
      AddressAutocomplete: AddressAutocomplete
    };
  });

}).call(this);
(function() {
  (function($) {
    var Kladr;
    $.fn.extend({
      kladr: function() {
        return this.each(function() {
          var plugin;
          if (!(plugin = $(this).data('kladr-plugin'))) {
            return $(this).data('kladr-plugin', new Kladr($(this)));
          }
        });
      }
    });
    Kladr = (function() {
      function Kladr(element) {
        this.element = element;
        this.prefix = this.element.data('kladr-prefix');
        this.counties = this.element.data('kladr-countries');
        this.kladrHost = window.location.protocol + '//' + this.element.data('kladr-host');
        this.kladrLocation = this.element.data('kladr-location') || {};
        this.element.html('');
        if (this.counties[this.currentCountry()]) {
          this.drawStartView();
        } else {
          this.drawStandardAddress(this.kladrLocation);
        }
        this.bind();
      }

      Kladr.prototype.createField = function(label, name, input, value) {
        input = $("<div class='field fc none-kladr-address'> <div class='field-label'> <label for='shipping_address_" + name + "' style='opacity: 1;'>" + label + ":</label> <span class='warning'>*</span></div> <div class='field-content'> " + input + "<div class='small'></div> </div> </div>");
        input.find(':input').val(value);
        return input;
      };

      Kladr.prototype.createTextField = function(label, name, value) {
        return this.createField(label, name, "<input class='textfield' id='shipping_address_" + name + "' name='" + this.prefix + "[" + name + "]' />", value || '');
      };

      Kladr.prototype.createTextArea = function(label, name, value) {
        return this.createField(label, name, "<textarea class='textfield' id='shipping_address_" + name + "' name='" + this.prefix + "[" + name + "]'></textarea>", value || '');
      };

      Kladr.prototype.drawStandardAddress = function(location) {
        var fullStateName;
        if ($('.none-kladr-address').length > 0) {
          return;
        }
        fullStateName = location != null ? location.state : void 0;
        if ((location != null ? location.state_type : void 0) && (location != null ? location.state : void 0)) {
          fullStateName = location.state_type + " " + location.state;
        }
        this.element.html('');
        this.element.append(this.createTextField("Регион", "state", fullStateName)).append(this.createTextField("Город", "city", location != null ? location.city : void 0)).append(this.createTextArea("Адрес", "address", location != null ? location.address : void 0)).append(this.createTextField("Индекс", "zip", location != null ? location.zip : void 0));
        return this.setKladrData();
      };

      Kladr.prototype.removeStandardAddress = function() {
        return $('.none-kladr-address').remove();
      };

      Kladr.prototype.currentCountry = function() {
        return $('#shipping_address_country').val();
      };

      Kladr.prototype.getChildrenByCode = function(code) {
        var url;
        url = this.kladrHost + '/children_by_code.json';
        url += '?country=' + this.currentCountry();
        if (code) {
          url += '&code=' + code;
        }
        return $.ajax({
          url: url,
          dataType: 'jsonp'
        });
      };

      Kladr.prototype.drawStartView = function() {
        var currentValue, i, inputField, len, ref, url, v, valueType;
        this.element.append("Индекс:\n<input type='text' class='textfield input-field' size='8' name='" + this.prefix + "[zip]' value='" + (this.kladrLocation.zip || '') + "'/>");
        if (this.kladrLocation.code) {
          ref = ['state', 'area', 'city', 'settlement', 'street'];
          for (i = 0, len = ref.length; i < len; i++) {
            v = ref[i];
            currentValue = this.kladrLocation[v];
            if (v === 'city' && this.kladrLocation[v] === this.kladrLocation.state && this.currentCountry() === 'RU') {
              continue;
            }
            if (currentValue) {
              valueType = this.kladrLocation[v + "_type"];
              if (valueType) {
                currentValue = currentValue + ", " + valueType;
              }
              inputField = $("<div class='kladr-selector'><input class='textfield input-field' type='text' disabled='disabled'></div>");
              inputField.find(':input').val(currentValue);
              this.element.append(inputField);
            }
          }
          if ((this.kladrLocation.street != null)) {
            this.drawHouseAndFlat(this.kladrLocation.house, this.kladrLocation.flat);
          }
          url = this.kladrHost + "/ancestry_by_code.json?country=" + (this.currentCountry()) + "&code=" + this.kladrLocation.code;
          return $.ajax({
            url: url,
            dataType: 'jsonp'
          }).done((function(_this) {
            return function(results) {
              var $nextLevel, fullStreetName, k;
              for (k in results) {
                v = results[k];
                $(_this.element.find('.kladr-selector')[k]).data('kladr-code', v.code);
                $(_this.element.find('.kladr-selector')[k]).data('kladr-json', v);
                _this.setKladrData(v);
              }
              _this.element.find('.kladr-selector :input').removeAttr('disabled');
              if (!_this.kladrLocation.street) {
                $nextLevel = $("<div class='kladr-selector'>\n  <input class='textfield input-field' type='text' value='' placeholder=\"продолжите ввод адреса...\">\n</div>");
                return _this.element.find('.kladr-selector:last').after($nextLevel);
              } else if (!_this.element.find('.kladr-selector:last').data('kladr-code')) {
                _this.element.find('.kladr-selector:last').remove();
                fullStreetName = _this.kladrLocation.street;
                if (_this.kladrLocation.street_type) {
                  fullStreetName = _this.kladrLocation.street_type + " " + _this.kladrLocation.street;
                }
                return _this.drawStreet(fullStreetName);
              }
            };
          })(this));
        } else {
          return this.element.append("<div class='kladr-selector'>\n  <input class='textfield input-field' type='text' value='' placeholder='Введите регион'>\n</div>");
        }
      };

      Kladr.prototype.drawStreet = function(value) {
        if (this.element.find('.kladr-selector-street').length > 0) {
          return true;
        }
        this.element.find('.kladr-selector:last').after("<div class='kladr-selector-street'>\n  <input class='textfield input-field' type='text' name='" + this.prefix + "[street]' value='" + (value || '') + "' placeholder='Введите улицу'>\n</div>");
        return this.drawHouseAndFlat(this.kladrLocation.house, this.kladrLocation.flat);
      };

      Kladr.prototype.drawHouseAndFlat = function(house, flat) {
        if (this.element.find('#kladr-place').length > 0) {
          return true;
        }
        return this.element.append("<div id='kladr-place'>\n  <div id='kladr-house'>\n    Дом:\n    <input class='textfield input-field' type='text' size='7' name='" + this.prefix + "[house]' value='" + (house || '') + "'/>\n  </div>\n  <div id='kladr-flat'>\n    Квартира:\n    <input class='textfield input-field' type='text' size='3' name='" + this.prefix + "[flat]' value='" + (flat || '') + "' />\n  </div>\n</div>");
      };

      Kladr.prototype.createTypeahead = function($selector, results) {
        var data, dataSets, engine, i, j, l, lastType, len, len1, len2, ref, ref1, resultsByTypes, selector, sourceParams, textType, type, typeaheadSource;
        resultsByTypes = {};
        for (i = 0, len = results.length; i < len; i++) {
          selector = results[i];
          lastType = 'other';
          ref = ['state', 'area', 'city', 'settlement', 'street'];
          for (j = 0, len1 = ref.length; j < len1; j++) {
            type = ref[j];
            if (selector[type]) {
              lastType = type;
            }
          }
          resultsByTypes[lastType] || (resultsByTypes[lastType] = []);
          resultsByTypes[lastType].push(selector);
        }
        dataSets = [];
        ref1 = ['city', 'state', 'area', 'settlement', 'street'];
        for (l = 0, len2 = ref1.length; l < len2; l++) {
          type = ref1[l];
          if (!resultsByTypes[type]) {
            continue;
          }
          data = resultsByTypes[type];
          engine = new Bloodhound({
            limit: 100,
            local: data,
            datumTokenizer: function(value) {
              if (value.last_level_type) {
                return [value.last_level_type, value.last_level];
              }
              return [value.last_level];
            },
            queryTokenizer: function(str) {
              str = '' + str;
              if (str) {
                return str.split(/, +/);
              }
              return [];
            }
          });
          engine.initialize(true);
          typeaheadSource = (function(engine) {
            return function(q, sync) {
              var len3, m, ref2, v, values;
              if (q === '') {
                values = [];
                ref2 = engine.index.datums;
                for (m = 0, len3 = ref2.length; m < len3; m++) {
                  v = ref2[m];
                  values.push(v);
                }
                return sync(values);
              } else {
                return engine.get(q, sync);
              }
            };
          })(engine);
          sourceParams = {
            source: typeaheadSource,
            display: function(value) {
              var fullLastLevelName;
              fullLastLevelName = value.last_level;
              if (value.last_level_type) {
                fullLastLevelName += ", " + value.last_level_type;
              }
              return fullLastLevelName;
            },
            templates: {
              empty: '<span class="empty-message">не найдено</span>'
            }
          };
          if (type !== 'other') {
            textType = type;
            if (type === 'state') {
              textType = 'Регионы:';
            }
            if (type === 'area') {
              textType = 'Районы:';
            }
            if (type === 'city') {
              textType = 'Города:';
            }
            if (type === 'settlement') {
              textType = 'Населенные пункты:';
            }
            if (type === 'street') {
              textType = 'Улицы:';
            }
            sourceParams.templates.header = "<strong>" + textType + "</strong>";
          }
          dataSets.push(sourceParams);
        }
        return $selector.find(':input:visible').typeahead({
          minLength: 0,
          highlight: true,
          hint: false
        }, dataSets);
      };

      Kladr.prototype.removeTail = function($selector) {
        $selector.data('kladr-json', null);
        $selector.data('kladr-code', null);
        $selector.nextAll().each(function(k, v) {
          if ($(this).data('typeahead-inited')) {
            return $(this).find(':input:visible').typeahead('destroy');
          }
        });
        $selector.nextAll().remove();
        $('#kladr-place').remove();
        return this.setKladrData($selector.prev().data('kladr-json'));
      };

      Kladr.prototype.setKladrData = function(data) {
        var fullCityName, fullStateName, fullStreetName, inputValue;
        this.shippingLocationElement().html('');
        inputValue = '';
        if (data) {
          inputValue = JSON.stringify($.extend({}, data, {
            is_kladr: true
          }));
        }
        fullStateName = (data != null ? data.state : void 0) || '';
        if ((data != null ? data.state_type : void 0) && (data != null ? data.state : void 0)) {
          fullStateName = (data != null ? data.state_type : void 0) + " " + (data != null ? data.state : void 0);
        }
        fullStreetName = (data != null ? data.street : void 0) || '';
        if ((data != null ? data.street_type : void 0) && (data != null ? data.street : void 0)) {
          fullStreetName = (data != null ? data.street_type : void 0) + " " + (data != null ? data.street : void 0);
        }
        fullCityName = (data != null ? data.city : void 0) || '';
        if (data != null ? data.settlement : void 0) {
          fullCityName = data.settlement;
        }
        this.shippingLocationElement().append($("<input type='hidden' name='" + this.prefix + "[kladr_json]'>").val(inputValue));
        this.shippingLocationElement().append($("<input type='hidden' name='" + this.prefix + "[state]'>").val(fullStateName));
        this.shippingLocationElement().append($("<input type='hidden' name='" + this.prefix + "[city]'>").val(fullCityName));
        this.shippingLocationElement().append($("<input type='hidden' name='" + this.prefix + "[street]'>").val(fullStreetName));
        this.shippingLocationElement().append("<input type='hidden' name='" + this.prefix + "[address]' value=''>");
        this.shippingLocationElement().append("<input type='hidden' name='" + this.prefix + "[house]' value=''>");
        return this.shippingLocationElement().append("<input type='hidden' name='" + this.prefix + "[flat]' value=''>");
      };

      Kladr.prototype.shippingLocationElement = function() {
        this.locationElement = this.element.find('[data-shipping-location]');
        if (this.locationElement.length === 0) {
          this.locationElement = $("<div data-shipping-location style='display: none'></div>");
          this.element.prepend(this.locationElement);
        }
        return this.locationElement;
      };

      Kladr.prototype.bind = function() {
        $('#shipping_address_country').on('change.kladr-autocomplete', (function(_this) {
          return function() {
            _this.element.html('');
            if (_this.counties[_this.currentCountry()]) {
              return _this.drawStartView();
            } else {
              return _this.drawStandardAddress();
            }
          };
        })(this));
        $(this.element).on('keydown.kladr-autocomplete', '.kladr-selector', (function(_this) {
          return function(e) {
            var keynum;
            if (window.event) {
              keynum = e.keyCode;
            } else if (e.which) {
              keynum = e.which;
            }
            if (keynum === 8 || keynum === 46) {
              _this.removeTail($(e.currentTarget));
            }
            return true;
          };
        })(this));
        $(this.element).on('keypress.kladr-autocomplete', '.kladr-selector', (function(_this) {
          return function(e) {
            var keynum, newChar, newValue, oldValue;
            if (window.event) {
              keynum = e.keyCode;
            } else if (e.which) {
              keynum = e.which;
            }
            newChar = String.fromCharCode(keynum);
            oldValue = $(e.currentTarget).find(':input:visible').val();
            newValue = oldValue + newChar;
            if (oldValue === newValue) {
              return true;
            }
            return _this.removeTail($(e.currentTarget));
          };
        })(this));
        $(this.element).on('click.kladr-autocomplete', '.kladr-selector :input:visible', (function(_this) {
          return function(e) {
            var promises;
            promises = _this.element.find('.kladr-selector').map(function(k, v) {
              var code, preloader;
              if ($(v).data('typeahead-inited')) {
                return $.Deferred().resolve();
              } else {
                $(v).data('typeahead-inited', true);
                code = $(v).prev().data('kladr-code');
                preloader = $("<img src='/served_assets/ajax_indicator.gif' style='margin-left:5px'/>");
                preloader.insertAfter(_this.element);
                return _this.getChildrenByCode(code).done(function(results) {
                  preloader.remove();
                  if (results.length > 0) {
                    return _this.createTypeahead($(v), results);
                  } else {
                    _this.drawStreet($(v).find(':input:visible').val());
                    $(v).remove();
                    return _this.element.find('.kladr-selector-street :input:visible').trigger('focus');
                  }
                });
              }
            });
            return $.when.apply(_this, promises).done(function() {
              var ev;
              $(e.currentTarget).trigger('focus');
              ev = $.Event("keydown");
              ev.keyCode = ev.which = 40;
              return $(e.currentTarget).trigger(ev);
            });
          };
        })(this));
        $(this.element).on('typeahead:closed', '.kladr-selector', (function(_this) {
          return function(e) {
            return $(e.currentTarget).find(':input:visible').attr('placeholder', 'продолжите ввод адреса...');
          };
        })(this));
        return $(this.element).on('typeahead:selected.kladr-autocomplete typeahead:autocompleted.kladr-autocomplete', '.kladr-selector', (function(_this) {
          return function(e, data, set) {
            var $nextLevel, lastData, preloader;
            $(e.currentTarget).data('kladr-json', data);
            $(e.currentTarget).data('kladr-code', data.code);
            lastData = null;
            _this.element.find('.kladr-selector').each(function(k, v) {
              if ($(v).data('kladr-json')) {
                return lastData = $(v).data('kladr-json');
              }
            });
            _this.setKladrData(lastData);
            if ($(e.currentTarget).next().is('.kladr-selector, #kladr-place')) {
              return true;
            }
            $nextLevel = $("<div class='kladr-selector'>\n  <input class='textfield input-field' type='text' value='' style='display: none' placeholder='продолжите ввод адреса...'>\n</div>");
            $(e.currentTarget).after($nextLevel);
            $nextLevel.data('typeahead-inited', true);
            preloader = $("<img src='/served_assets/ajax_indicator.gif' style='margin-left:5px'/>");
            preloader.insertAfter(_this.element);
            return _this.getChildrenByCode($(e.currentTarget).data('kladr-code')).done(function(results) {
              var ev;
              preloader.remove();
              if (results.length > 0) {
                $nextLevel.find(':input').show();
                _this.createTypeahead($nextLevel, results);
                $nextLevel.find(':input:visible').trigger('focus');
                ev = $.Event("keydown");
                ev.keyCode = ev.which = 40;
                return $nextLevel.find(':input:visible').trigger(ev);
              } else {
                if (!data.street) {
                  _this.drawStreet();
                }
                _this.drawHouseAndFlat();
                return $nextLevel.remove();
              }
            });
          };
        })(this));
      };

      return Kladr;

    })();
    return $((function(_this) {
      return function() {
        return $('[data-kladr-location]').kladr();
      };
    })(this));
  })(jQuery);

}).call(this);
// триггер открытия модалки
$(document).on('click', '.js-modal-toggler', function( event ){
  event.preventDefault();

  var target = $(this).data('target');
  var $modal = $(target);

  ModalOpen( $modal, event )
});

// триггер закрытия модалки
$(document).on('click touchstart', '.js-modal-close', function( event ){
  event.preventDefault();

  var $modal = $(this).parents( '.co-modal:first' );

  ModalClose( $modal );
});

//  закрываем через esc
$(document).on('keyup', function( event ){
  if( event.keyCode == 27 ){
    var $modal_list = $( '.co-modal' );
    var timeStamp = 0;
    var $target;

    if (!$modal_list.length) {
      return false;
    }

    $modal_list.each( function(){
      var $modal = $(this);
      var openAt = $modal.data( 'openAt' );
      if( !$modal.hasClass('co-modal--hide') && timeStamp < openAt ){
        timeStamp = openAt;
        $target = $modal;
      }
    });

    ModalClose( $target );
  }
});

//  нажали кнопку "войти"
$(document).on('click touchstart', '.js-modal-submit--login', function( event ){
  event.preventDefault();

  var $modal = $(this).parents( '.co-modal:first' );
  var $form = $(this).parents( 'form:first' );
  var errors = checkForm( $form );

  if( errors.length ){
    return false;
  }
});

function ModalOpen ( $modal, event ) {
  var $overlay = $( '.co-overlay' );

  var alreadyHasOpenModal = $('.co-modal').not('.co-modal--hide').length

  $overlay
    .addClass( 'co-overlay--show' );

  $modal
    .removeClass( 'co-modal--hide' )
    .data('openAt', event.timeStamp);

  bindOffsetClick( $modal );

  // Если идект открытие модалки в модалке )
  if (alreadyHasOpenModal)
    return

  scrollLock();
}

//  Закрываем модалку
function ModalClose( $modal, event ){
  var $overlay = $( '.co-overlay' );

  $modal
    .addClass( 'co-modal--hide' );

  $modal
    .find('.co-input')
      .removeClass('co-input--error');

  $(document).off( event, OffsetClick );

  // Если это модалка в модалке, могут быть еще открытые окна
  var stillHasOpenModal = $('.co-modal').not('.co-modal--hide').length

  if (!stillHasOpenModal) {
    $overlay.removeClass('co-overlay--show');
    scrollUnlock();
  }
}

//  вешаем отлов события "кто-то жамкнул вне модалки"
function bindOffsetClick( $modal ){
  $(document).on( 'click', { obj: $modal }, OffsetClick );
}

//  Кликнули вне модалки
function OffsetClick( event ){
  var $modal = event.data.obj;

  if( $(event.target).closest( $modal ).length ){
    return true;
  }

  if ( !$(event.target).hasClass('co-overlay') ) {
    return true;
  }

  ModalClose( $modal, event );
}

// блочим прокрутку страницы
//  ультимативно во сех браузерах и платформах
function scrollLock(){
  var $window = $(window);
  var $body = $('html');
  var $page = $('body');
  var scroll = $window.scrollTop();

  $body.addClass('lock_scroll');
  $page.css({
    'margin-top': -scroll,
    'height': 'calc(100% + '+ scroll +'px)',
  });
}

//  разлочиваем прокрутку
function scrollUnlock(){
  var $window = $(window);
  var $body = $('html');
  var $page = $('body');
  var scroll = -parseInt($page.css('margin-top'));

  $body.removeClass('lock_scroll');
  $page.removeAttr('style');
  $window.scrollTop(scroll);

  //INFO: IE как всегда показал себя во всей красе - он не умеет пересчитывать страницу пока его не пнёшь под зад
  $page.css('padding', 1);
  setTimeout(function() {
    $page.removeAttr('style');
  }, 0);
}
;




























(function(){
  $.migrateMute = true;
  $.noConflict(true);

  // не добавляем ничего в наш контекст
  window.define = void null;

  init = function($, InSales, ExportApi){
    ExportApi.exportApi();
    ExportApi.exportJQuery();

    window.require = void null;
    window.requirejs = void null;

    $(function() {
      InSales.init();
    });
  };

  requirejs([
    'jquery',
    'shop/public/insales',
    'shop/export_api',
    // --------------------
    'jquery-migrate',
    'jquery.cookie',
    'jquery.trigger_custom',
    'shop/set_locale',
    'shop/quick_checkout',
    'shop/checkout_init',
    'shop/address_autocomplete',
    'shop/bank_bills'
  ], init, null, true);
})();
