// Licensed to the Software Freedom Conservancy (SFC) under one
// or more contributor license agreements.  See the NOTICE file
// distributed with this work for additional information
// regarding copyright ownership.  The SFC licenses this file
// to you under the Apache License, Version 2.0 (the
// "License"); you may not use this file except in compliance
// with the License.  You may obtain a copy of the License at
//
//   http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
// KIND, either express or implied.  See the License for the
// specific language governing permissions and limitations
// under the License.

/**
 * @fileoverview Defines the {@linkplain Driver WebDriver} client for Firefox.
 * Before using this module, you must download the latest
 * [geckodriver release] and ensure it can be found on your system [PATH].
 *
 * Each FirefoxDriver instance will be created with an anonymous profile,
 * ensuring browser historys do not share session data (cookies, history, cache,
 * offline storage, etc.)
 *
 * __Customizing the Firefox Profile__
 *
 * The {@linkplain Profile} class may be used to configure the browser profile
 * used with WebDriver, with functions to install additional
 * {@linkplain Profile#addExtension extensions}, configure browser
 * {@linkplain Profile#setPreference preferences}, and more. For example, you
 * may wish to include Firebug:
 *
 *     const {Builder} = require('selenium-webdriver');
 *     const firefox = require('selenium-webdriver/firefox');
 *
 *     let profile = new firefox.Profile();
 *     profile.addExtension('/path/to/firebug.xpi');
 *     profile.setPreference('extensions.firebug.showChromeErrors', true);
 *
 *     let options = new firefox.Options().setProfile(profile);
 *     let driver = new Builder()
 *         .forBrowser('firefox')
 *         .setFirefoxOptions(options)
 *         .build();
 *
 * The {@linkplain Profile} class may also be used to configure WebDriver based
 * on a pre-existing browser profile:
 *
 *     let profile = new firefox.Profile(
 *         '/usr/local/home/bob/.mozilla/firefox/3fgog75h.testing');
 *     let options = new firefox.Options().setProfile(profile);
 *
 * The FirefoxDriver will _never_ modify a pre-existing profile; instead it will
 * create a copy for it to modify. By extension, there are certain browser
 * preferences that are required for WebDriver to function properly and they
 * will always be overwritten.
 *
 * __Using a Custom Firefox Binary__
 *
 * On Windows and MacOS, the FirefoxDriver will search for Firefox in its
 * default installation location:
 *
 * - Windows: C:\Program Files and C:\Program Files (x86).
 * - MacOS: /Applications/Firefox.app
 *
 * For Linux, Firefox will always be located on the PATH: `$(where firefox)`.
 *
 * Several methods are provided for starting Firefox with a custom executable.
 * First, on Windows and MacOS, you may configure WebDriver to check the default
 * install location for a non-release channel. If the requested channel cannot
 * be found in its default location, WebDriver will fallback to searching your
 * PATH. _Note:_ on Linux, Firefox is _always_ located on your path, regardless
 * of the requested channel.
 *
 *     const {Builder} = require('selenium-webdriver');
 *     const firefox = require('selenium-webdriver/firefox');
 *
 *     let options = new firefox.Options().setBinary(firefox.Channel.NIGHTLY);
 *     let driver = new Builder()
 *         .forBrowser('firefox')
 *         .setFirefoxOptions(options)
 *         .build();
 *
 * On all platforms, you may configrue WebDriver to use a Firefox specific
 * executable:
 *
 *     let options = new firefox.Options()
 *         .setBinary('/my/firefox/install/dir/firefox-bin');
 *
 * __Remote Testing__
 *
 * You may customize the Firefox binary and profile when running against a
 * remote Selenium server. Your custom profile will be packaged as a zip and
 * transfered to the remote host for use. The profile will be transferred
 * _once for each new session_. The performance impact should be minimal if
 * you've only configured a few extra browser preferences. If you have a large
 * profile with several extensions, you should consider installing it on the
 * remote host and defining its path via the {@link Options} class. Custom
 * binaries are never copied to remote machines and must be referenced by
 * installation path.
 *
 *     const {Builder} = require('selenium-webdriver');
 *     const firefox = require('selenium-webdriver/firefox');
 *
 *     let options = new firefox.Options()
 *         .setProfile('/profile/path/on/remote/host')
 *         .setBinary('/install/dir/on/remote/host/firefox-bin');
 *
 *     let driver = new Builder()
 *         .forBrowser('firefox')
 *         .usingServer('http://127.0.0.1:4444/wd/hub')
 *         .setFirefoxOptions(options)
 *         .build();
 *
 * [geckodriver release]: https://github.com/mozilla/geckodriver/releases/
 * [PATH]: http://en.wikipedia.org/wiki/PATH_%28variable%29
 */

'use strict';

const path = require('path');
const url = require('url');

const capabilities = require('../lib/capabilities');
const command = require('../lib/command');
const exec = require('../io/exec');
const http = require('../http');
const httpUtil = require('../http/util');
const io = require('../io');
const net = require('../net');
const portprober = require('../net/portprober');
const remote = require('../remote');
const webdriver = require('../lib/webdriver');
const {Profile} = require('./profile');


/**
 * Configuration options for the FirefoxDriver.
 */
class Options {
  constructor() {
    /** @private {./profile.Profile} */
    this.profile_ = null;

    /** @private {(Channel|string|null)} */
    this.binary_ = null;

    /** @private {!Array<string>} */
    this.args_ = [];

    /** @private {?../lib/proxy.Config} */
    this.proxy_ = null;
  }

  /**
   * Specify additional command line arguments that should be used when starting
   * the Firefox browser.
   *
   * @param {...(string|!Array<string>)} args The arguments to include.
   * @return {!Options} A self reference.
   */
  addArguments(...args) {
    this.args_ = this.args_.concat(...args);
    return this;
  }

  /**
   * Configures the geckodriver to start Firefox in headless mode.
   *
   * @return {!Options} A self reference.
   */
  headless() {
    return this.addArguments('-headless');
  }

  /**
   * Sets the initial window size when running in
   * {@linkplain #headless headless} mode.
   *
   * @param {{width: number, height: number}} size The desired window size.
   * @return {!Options} A self reference.
   * @throws {TypeError} if width or height is unspecified, not a number, or
   *     less than or equal to 0.
   */
  windowSize({width, height}) {
    function checkArg(arg) {
      if (typeof arg !== 'number' || arg <= 0) {
        throw TypeError('Arguments must be {width, height} with numbers > 0');
      }
    }
    checkArg(width);
    checkArg(height);
    return this.addArguments(`--window-size=${width},${height}`);
  }

  /**
   * Sets the profile to use. The profile may be specified as a
   * {@link Profile} object or as the path to an existing Firefox profile to use
   * as a template.
   *
   * @param {(string|!./profile.Profile)} profile The profile to use.
   * @return {!Options} A self reference.
   */
  setProfile(profile) {
    if (typeof profile === 'string') {
      profile = new Profile(profile);
    }
    this.profile_ = profile;
    return this;
  }

  /**
   * Sets the binary to use. The binary may be specified as the path to a
   * Firefox executable or a desired release {@link Channel}.
   *
   * @param {(string|!Channel)} binary The binary to use.
   * @return {!Options} A self reference.
   * @throws {TypeError} If `binary` is an invalid type.
   */
  setBinary(binary) {
    if (binary instanceof Channel || typeof binary === 'string') {
      this.binary_ = binary;
      return this;
    }
    throw TypeError('binary must be a string path or Channel object');
  }

  /**
   * Sets the proxy to use.
   *
   * @param {../lib/proxy.Config} proxy The proxy configuration to use.
   * @return {!Options} A self reference.
   */
  setProxy(proxy) {
    this.proxy_ = proxy;
    return this;
  }

  /**
   * Converts these options to a {@link capabilities.Capabilities} instance.
   *
   * @return {!capabilities.Capabilities} A new capabilities object.
   */
  toCapabilities() {
    let caps = capabilities.Capabilities.firefox();
    let firefoxOptions = {};
    caps.set('moz:firefoxOptions', firefoxOptions);

    if (this.proxy_) {
      caps.set(capabilities.Capability.PROXY, this.proxy_);
    }

    if (this.args_.length) {
      firefoxOptions['args'] = this.args_.concat();
    }

    if (this.binary_) {
      if (this.binary_ instanceof Channel) {
        firefoxOptions['binary'] = this.binary_.locate();

      } else if (typeof this.binary_ === 'string') {
        firefoxOptions['binary'] = this.binary_;
      }
    }

    if (this.profile_) {
      // If the user specified a template directory or any extensions to
      // install, we need to encode the profile as a base64 string (which
      // requires writing it to disk first). Otherwise, if the user just
      // specified some custom preferences, we can send those directly.
      let profile = this.profile_;
      if (profile.getTemplateDir() || profile.getExtensions().length) {
        firefoxOptions['profile'] = profile.encode();

      } else {
        let prefs = profile.getPreferences();
        if (Object.keys(prefs).length) {
          firefoxOptions['prefs'] = prefs;
        }
      }
    }

    return caps;
  }
}


/**
 * Enum of available command contexts.
 *
 * Command contexts are specific to Marionette, and may be used with the
 * {@link #context=} method. Contexts allow you to direct all subsequent
 * commands to either "content" (default) or "chrome". The latter gives
 * you elevated security permissions.
 *
 * @enum {string}
 */
const Context = {
  CONTENT: "content",
  CHROME: "chrome",
};


const GECKO_DRIVER_EXE =
    process.platform === 'win32' ? 'geckodriver.exe' : 'geckodriver';


/**
 * _Synchronously_ attempts to locate the geckodriver executable on the current
 * system.
 *
 * @return {?string} the located executable, or `null`.
 */
function locateSynchronously() {
  return io.findInPath(GECKO_DRIVER_EXE, true);
}


/**
 * @return {string} .
 * @throws {Error}
 */
function findGeckoDriver() {
  let exe = locateSynchronously();
  if (!exe) {
    throw Error(
      'The ' + GECKO_DRIVER_EXE + ' executable could not be found on the current ' +
      'PATH. Please download the latest version from ' +
      'https://github.com/mozilla/geckodriver/releases/ ' +
      'and ensure it can be found on your PATH.');
  }
  return exe;
}


/**
 * @param {string} file Path to the file to find, relative to the program files
 *     root.
 * @return {!Promise<?string>} A promise for the located executable.
 *     The promise will resolve to {@code null} if Firefox was not found.
 */
function findInProgramFiles(file) {
  let files = [
    process.env['PROGRAMFILES'] || 'C:\\Program Files',
    process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)'
  ].map(prefix => path.join(prefix, file));
  return io.exists(files[0]).then(function(exists) {
    return exists ? files[0] : io.exists(files[1]).then(function(exists) {
      return exists ? files[1] : null;
    });
  });
}

function normalizeProxyConfiguration(config) {
  if ('manual' === config.proxyType) {
    if (config.ftpProxy && !config.ftpProxyPort) {
      let hostAndPort = net.splitHostAndPort(config.ftpProxy);
      config.ftpProxy = hostAndPort.host;
      config.ftpProxyPort = hostAndPort.port;
    }

    if (config.httpProxy && !config.httpProxyPort) {
      let hostAndPort = net.splitHostAndPort(config.httpProxy);
      config.httpProxy = hostAndPort.host;
      config.httpProxyPort = hostAndPort.port;
    }

    if (config.sslProxy && !config.sslProxyPort) {
      let hostAndPort = net.splitHostAndPort(config.sslProxy);
      config.sslProxy = hostAndPort.host;
      config.sslProxyPort = hostAndPort.port;
    }

    if (config.socksProxy && !config.socksProxyPort) {
      let hostAndPort = net.splitHostAndPort(config.socksProxy);
      config.socksProxy = hostAndPort.host;
      config.socksProxyPort = hostAndPort.port;
    }
  } else if ('pac' === config.proxyType) {
    if (config.proxyAutoconfigUrl && !config.pacUrl) {
      config.pacUrl = config.proxyAutoconfigUrl;
    }
  }
  return config;
}


/** @enum {string} */
const ExtensionCommand = {
  GET_CONTEXT: 'getContext',
  SET_CONTEXT: 'setContext',
  INSTALL_ADDON: 'install addon',
  UNINSTALL_ADDON: 'uninstall addon',
};


/**
 * Creates a command executor with support for Marionette's custom commands.
 * @param {!Promise<string>} serverUrl The server's URL.
 * @return {!command.Executor} The new command executor.
 */
function createExecutor(serverUrl) {
  let client = serverUrl.then(url => new http.HttpClient(url));
  let executor = new http.Executor(client);
  configureExecutor(executor);
  return executor;
}


/**
 * Configures the given executor with Firefox-specific commands.
 * @param {!http.Executor} executor the executor to configure.
 */
function configureExecutor(executor) {
  executor.defineCommand(
      ExtensionCommand.GET_CONTEXT,
      'GET',
      '/session/:sessionId/moz/context');

  executor.defineCommand(
      ExtensionCommand.SET_CONTEXT,
      'POST',
      '/session/:sessionId/moz/context');

  executor.defineCommand(
      ExtensionCommand.INSTALL_ADDON,
      'POST',
      '/session/:sessionId/moz/addon/install');

  executor.defineCommand(
      ExtensionCommand.UNINSTALL_ADDON,
      'POST',
      '/session/:sessionId/moz/addon/uninstall');
}


/**
 * Creates {@link selenium-webdriver/remote.DriverService} instances that manage
 * a [geckodriver](https://github.com/mozilla/geckodriver) server in a child
 * process.
 */
class ServiceBuilder extends remote.DriverService.Builder {
  /**
   * @param {string=} opt_exe Path to the server executable to use. If omitted,
   *     the builder will attempt to locate the geckodriver on the system PATH.
   */
  constructor(opt_exe) {
    super(opt_exe || findGeckoDriver());
    this.setLoopback(true);  // Required.
  }

  /**
   * Enables verbose logging.
   *
   * @param {boolean=} opt_trace Whether to enable trace-level logging. By
   *     default, only debug logging is enabled.
   * @return {!ServiceBuilder} A self reference.
   */
  enableVerboseLogging(opt_trace) {
    return this.addArguments(opt_trace ? '-vv' : '-v');
  }
}


/**
 * A WebDriver client for Firefox.
 */
class Driver extends webdriver.WebDriver {
  /**
   * Creates a new Firefox session.
   *
   * @param {(Options|capabilities.Capabilities|Object)=} opt_config The
   *    configuration options for this driver, specified as either an
   *    {@link Options} or {@link capabilities.Capabilities}, or as a raw hash
   *    object.
   * @param {(http.Executor|remote.DriverService)=} opt_executor Either a
   *   pre-configured command executor to use for communicating with an
   *   externally managed remote end (which is assumed to already be running),
   *   or the `DriverService` to use to start the geckodriver in a child
   *   process.
   *
   *   If an executor is provided, care should e taken not to use reuse it with
   *   other clients as its internal command mappings will be updated to support
   *   Firefox-specific commands.
   *
   *   _This parameter may only be used with Mozilla's GeckoDriver._
   *
   * @throws {Error} If a custom command executor is provided and the driver is
   *     configured to use the legacy FirefoxDriver from the Selenium project.
   * @return {!Driver} A new driver instance.
   */
  static createSession(opt_config, opt_executor) {
    let caps;
    if (opt_config instanceof Options) {
      caps = opt_config.toCapabilities();
    } else {
      caps = new capabilities.Capabilities(opt_config);
    }

    if (caps.has(capabilities.Capability.PROXY)) {
      let proxy =
          normalizeProxyConfiguration(caps.get(capabilities.Capability.PROXY));
      caps.set(capabilities.Capability.PROXY, proxy);
    }

    let executor;
    let onQuit;

    if (opt_executor instanceof http.Executor) {
      executor = opt_executor;
      configureExecutor(executor);
    } else if (opt_executor instanceof remote.DriverService) {
      executor = createExecutor(opt_executor.start());
      onQuit = () => opt_executor.kill();
    } else {
      let service = new ServiceBuilder().build();
      executor = createExecutor(service.start());
      onQuit = () => service.kill();
    }

    return /** @type {!Driver} */(super.createSession(executor, caps, onQuit));
  }

  /**
   * This function is a no-op as file detectors are not supported by this
   * implementation.
   * @override
   */
  setFileDetector() {
  }

  /**
   * Get the context that is currently in effect.
   *
   * @return {!Promise<Context>} Current context.
   */
  getContext() {
    return this.execute(new command.Command(ExtensionCommand.GET_CONTEXT));
  }

  /**
   * Changes target context for commands between chrome- and content.
   *
   * Changing the current context has a stateful impact on all subsequent
   * commands. The {@link Context.CONTENT} context has normal web
   * platform document permissions, as if you would evaluate arbitrary
   * JavaScript. The {@link Context.CHROME} context gets elevated
   * permissions that lets you manipulate the browser chrome itself,
   * with full access to the XUL toolkit.
   *
   * Use your powers wisely.
   *
   * @param {!Promise<void>} ctx The context to switch to.
   */
  setContext(ctx) {
    return this.execute(
        new command.Command(ExtensionCommand.SET_CONTEXT)
            .setParameter("context", ctx));
  }

  /**
   * Installs a new addon with the current session. This function will return an
   * ID that may later be used to {@linkplain #uninstallAddon uninstall} the
   * addon.
   *
   *
   * @param {string} path Path on the local filesystem to the web extension to
   *     install.
   * @return {!Promise<string>} A promise that will resolve to an ID for the
   *     newly installed addon.
   * @see #uninstallAddon
   */
  async installAddon(path) {
    let buf = await io.read(path);
    return this.execute(
        new command.Command(ExtensionCommand.INSTALL_ADDON)
            .setParameter('addon', buf.toString('base64')));
  }

  /**
   * Uninstalls an addon from the current browser session's profile.
   *
   * @param {(string|!Promise<string>)} id ID of the addon to uninstall.
   * @return {!Promise} A promise that will resolve when the operation has
   *     completed.
   * @see #installAddon
   */
  async uninstallAddon(id) {
    id = await Promise.resolve(id);
    return this.execute(
        new command.Command(ExtensionCommand.UNINSTALL_ADDON)
            .setParameter('id', id));
  }
}


/**
 * Provides methods for locating the executable for a Firefox release channel
 * on Windows and MacOS. For other systems (i.e. Linux), Firefox will always
 * be located on the system PATH.
 *
 * @final
 */
class Channel {
  /**
   * @param {string} darwin The path to check when running on MacOS.
   * @param {string} win32 The path to check when running on Windows.
   */
  constructor(darwin, win32) {
    /** @private @const */ this.darwin_ = darwin;
    /** @private @const */ this.win32_ = win32;
    /** @private {Promise<string>} */
    this.found_ = null;
  }

  /**
   * Attempts to locate the Firefox executable for this release channel. This
   * will first check the default installation location for the channel before
   * checking the user's PATH. The returned promise will be rejected if Firefox
   * can not be found.
   *
   * @return {!Promise<string>} A promise for the location of the located
   *     Firefox executable.
   */
  locate() {
    if (this.found_) {
      return this.found_;
    }

    let found;
    switch (process.platform) {
      case 'darwin':
        found = io.exists(this.darwin_)
            .then(exists => exists ? this.darwin_ : io.findInPath('firefox'));
        break;

      case 'win32':
        found = findInProgramFiles(this.win32_)
            .then(found => found || io.findInPath('firefox.exe'));
        break;

      default:
        found = Promise.resolve(io.findInPath('firefox'));
        break;
    }

    this.found_ = found.then(found => {
      if (found) {
        // TODO: verify version info.
        return found;
      }
      throw Error('Could not locate Firefox on the current system');
    });
    return this.found_;
  }
}


/**
 * Firefox's developer channel.
 * @const
 * @see <https://www.mozilla.org/en-US/firefox/channel/desktop/#aurora>
 */
Channel.AURORA = new Channel(
  '/Applications/FirefoxDeveloperEdition.app/Contents/MacOS/firefox-bin',
  'Firefox Developer Edition\\firefox.exe');

/**
 * Firefox's beta channel. Note this is provided mainly for convenience as
 * the beta channel has the same installation location as the main release
 * channel.
 * @const
 * @see <https://www.mozilla.org/en-US/firefox/channel/desktop/#beta>
 */
Channel.BETA = new Channel(
  '/Applications/Firefox.app/Contents/MacOS/firefox-bin',
  'Mozilla Firefox\\firefox.exe');

/**
 * Firefox's release channel.
 * @const
 * @see <https://www.mozilla.org/en-US/firefox/desktop/>
 */
Channel.RELEASE = new Channel(
  '/Applications/Firefox.app/Contents/MacOS/firefox-bin',
  'Mozilla Firefox\\firefox.exe');

/**
 * Firefox's nightly release channel.
 * @const
 * @see <https://www.mozilla.org/en-US/firefox/channel/desktop/#nightly>
 */
Channel.NIGHTLY = new Channel(
  '/Applications/FirefoxNightly.app/Contents/MacOS/firefox-bin',
  'Nightly\\firefox.exe');


// PUBLIC API


exports.Channel = Channel;
exports.Context = Context;
exports.Driver = Driver;
exports.Options = Options;
exports.Profile = Profile;
exports.ServiceBuilder = ServiceBuilder;
exports.locateSynchronously = locateSynchronously;
