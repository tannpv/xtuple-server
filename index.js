global.log = require('npmlog');
log.heading = 'xtuple-server';

var lib = require('xtuple-server-lib'),
  Q = require('q'),
  semver = require('semver'),
  _ = require('lodash');

function prefix (phaseName, taskName) {
  return phaseName + '.' + taskName;
}

function uninstall (options) {
  _.each(options.plan.reverse(), function (phase) {
    var phaseName = phase.name;
    _.each(phase.tasks, function (taskName) {
      var task = lib.util.requireTask(phaseName, taskName);
      task.uninstall(options);
    });
  });
}

function executePlan (plan, options) {
  options.plan = plan;

  if (!_.isString(options.planName)) {
    throw new Error('planName is required');
  }

  // beforeInstall
  log.info('xtuple', 'Pre-flight checks...');
  lib.util.eachTask(plan, function (task, phase, taskName) {
    log.verbose(prefix(phase.name, taskName), 'beforeInstall');
    task.beforeInstall(options);
  }, options);

  if (/^uninstall/.test(options.planName)) {
    return uninstall(options);
  }

  // execute plan tasks
  lib.util.eachTask(plan, function (task, phase, taskName) {
    var phaseOptions = phase.options || { };

    if (phaseOptions.execute !== false) {
      log.info(prefix(phase.name, taskName), 'Running...');
      task.beforeTask(options);
      task.executeTask(options);
      task.afterTask(options);
    }

  }, options);

  log.info('xtuple', 'Finishing...');
  lib.util.eachTask(plan, function (task, phase, taskName) {
    log.verbose(prefix(phase.name, taskName), 'afterInstall');
    task.afterInstall(options);
  }, options);
}

var planner = module.exports = {

  verifyOptions: function (plan, options) {
    log.verbose('verifyOptions');
    if (_.isEmpty(options.type)) {
      throw new TypeError('<type> is a required field');
    }
    lib.util.eachTask(plan, function (task, phase, taskName) {
      _.each(task.options, function (option, key) {
        log.verbose('verifyOptions', 'verifying', key);
        if (_.isFunction(option.validate) && phase.options.validate !== false) {
          // this will throw an exception if invalid
          log.verbose(prefix(phase.name, taskName), 'Validating Option: '+ key);
          try {
            options[phase.name][key] = option.validate(options[phase.name][key], options);
          }
          catch (e) {
            log.error('verifyOptions', e.message);
            log.error('verifyOptions', e.stack.split('\n'));
            process.exit(1);
          }
        }
      });
    });
  },

  /**
    * Compile a pure, non-commander based options object.
    */
  compileOptions: function (plan, options) {
    lib.util.eachTask(plan, function (task, phase, taskName) {
      options[phase.name] || (options[phase.name] = { });
      options[phase.name][taskName] || (options[phase.name][taskName] = { });

      phase.options || (phase.options = { });

      // load in default options specified in planfile
      if (_.isObject(phase.options)) {
        _.defaults(options[phase.name], phase.options);
      }

      // load in default options specified in task modules
      _.each(task.options, function (option, optionName) {
        if (_.isUndefined(options[phase.name][optionName])) {
          options[phase.name][optionName] = option.value;
        }
      });
    });
  },

  /**
   * Run planner with the specified plan and options. Atomic.
   * @returns promise
   */
  execute: function (plan, options) {
    var deferred = Q.defer();

    setTimeout(function () {
      try {
        executePlan(plan, options);
        deferred.resolve(options);
      }
      catch (e) {
        deferred.reject(e);
      }
    }, 10);

    return deferred.promise;
  }
};
