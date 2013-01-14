
/**
 * @fileoverview Logic for the Yes/No/Maybe app.
 *
 * @author Tim Blasi (Google)
 */

/** @enum {string} */
var Answers = {
	ZERO: '0',
	HALF: '1/2',
	ONE: '1',
	TWO: '2',
	THREE: '3',
	FIVE: '5',
	EIGHT: '8',
	UNKNOWN: 'u',
	COFFEE: 'c'
};
var HOST = '//hangoutsapi.appspot.com/static/yesnomaybe';

var DEFAULT_ICONS = {};
DEFAULT_ICONS[Answers.YES] = HOST + '/yes.png';
DEFAULT_ICONS[Answers.NO] = HOST + '/no.png';
DEFAULT_ICONS[Answers.MAYBE] = HOST + '/maybe.png';
DEFAULT_ICONS[Answers.UNKNOWN] = HOST + '/maybe.png';

var DEFAULT_STATUS = {};
DEFAULT_STATUS[Answers.ZERO] = '0';
DEFAULT_STATUS[Answers.HALF] = '1/2';
DEFAULT_STATUS[Answers.ONE] = '1';
DEFAULT_STATUS[Answers.TWO] = '2';
DEFAULT_STATUS[Answers.THREE] = '3';
DEFAULT_STATUS[Answers.FIVE] = '5';
DEFAULT_STATUS[Answers.EIGHT] = '8';
DEFAULT_STATUS[Answers.UNKNOWN] = 'No idea!';
DEFAULT_STATUS[Answers.COFFEE] = 'Coffee!';


/**
 * The maximum length allowed for user status.
 * @const
 * @type {number}
 */
var MAX_STATUS_LENGTH = 255;

/**
 * Whether the user is currently editing his status.
 * @type {boolean}
 * @private
 */
var statusVisible_ = false;
/**
 * Whether the user is currently editing a userstory.
 * @type {boolean}
 * @private
 */
var userStoryVisible_ = false;

/**
 * Shared state of the app.
 * @type {Object.<!string, !string>}
 * @private
 */
var state_ = null;

/**
 * Describes the shared state of the object.
 * @type {Object.<!string, Object.<!string, *>>}
 * @private
 */
var metadata_ = null;

/**
 * A list of the participants.
 * @type {Array.<gapi.hangout.Participant>}
 * @private
 */
var participants_ = null;

/**
 * The form that contains the status input element.
 * @type {Element}
 * @private
 */
var statusForm_ = null;

/**
 * The element used to input status messages.
 * @type {Element}
 * @private
 */
var statusInput_ = null;

/**
 * The form that contains the status input element.
 * @type {Element}
 * @private
 */
var userStoryForm_ = null;

/**
 * The element used to input status messages.
 * @type {Element}
 * @private
 */
var userStoryInput_ = null;

/**
 * The container for the app controls.
 * @type {Element}
 * @private
 */
var container_ = null;

/**
 * The container for the app controls.
 * @type {Element}
 * @private
 */
var userStoryList_ = null;

/**
 * Executes the provided function after a minor delay.
 * @param {function()} func The function to execute.
 */
function defer(func) {
	window.setTimeout(func, 10);
}

/**
 * Creates a key for use in the shared state.
 * @param {!string} id The user's temporary id.
 * @param {!string} key The property to create a key for.
 * @return {!string} A new key for use in the shared state.
 */
function makeUserKey(id, key) {
	return id + ':' + key;
}

/**
 * Makes an RPC call to store the given value(s) in the shared state.
 * @param {!(string|Object.<!string, !string>)} keyOrState Either an object
 *     denoting the desired key value pair(s), or a single string key.
 * @param {!string=} opt_value If keyOrState is a string, the associated value.
 */
var saveValue = null;

/**
 * Makes an RPC call to remove the given value(s) from the shared state.
 * @param {!(string|Array.<!string>)} keyOrListToRemove A single key
 *     or an array of strings to remove from the shared state.
 */
var removeValue = null;

/**
 * Makes an RPC call to add and/or remove the given value(s) from the shared
 * state.
 * @param {?(string|Object.<!string, !string>)} addState  Either an object
 *     denoting the desired key value pair(s), or a single string key.
 * @param {?(string|Object.<!string, !string>)=} opt_removeState A list of keys
 *     to remove from the shared state.
 */
var submitDelta = null;

(function() {
	/**
	 * Packages the parameters into a delta object for use with submitDelta.
	 * @param {!(string|Object.<!string, !string>)}  Either an object denoting
	 *     the desired key value pair(s), or a single string key.
	 * @param {!string=} opt_value If keyOrState is a string, the associated
	 *     string value.
	 */
	var prepareForSave = function(keyOrState, opt_value) {
		var state = null;
		if (typeof keyOrState === 'string') {
			state = {};
			state[keyOrState]= opt_value;
		} else if (typeof keyOrState === 'object' && null !== keyOrState) {
			// Ensure that no prototype-level properties are hitching a ride.
			state = {};
			for (var key in keyOrState) {
				if (keyOrState.hasOwnProperty(key)) {
					state[key] = keyOrState[key];
				}
			}
		} else {
			throw 'Unexpected argument.';
		}
		return state;
	};

	/**
	 * Packages one or more keys to remove for use with submitDelta.
	 * @param {!(string|Array.<!string>)} keyOrListToRemove A single key
	 *     or an array of strings to remove from the shared state.
	 * @return {!Array.<!string>} A list of keys to remove from the shared state.
	 */
	var prepareForRemove = function(keyOrListToRemove) {
		var delta = null;
		if (typeof keyOrListToRemove === 'string') {
			delta = [keyOrListToRemove];
		} else if (typeof keyOrListToRemove.length === 'number' &&
			keyOrListToRemove.propertyIsEnumerable('length')) {
			// Discard non-string elements.
			for (var i = 0, iLen = keyOrListToRemove.length; i < iLen; ++i) {
				if (typeof keyOrListToRemove[i] === 'string') {
					delta.push(keyOrListToRemove[i]);
				}
			}
		} else {
			throw 'Unexpected argument.';
		}
		return delta;
	};

	/**
	 * Makes an RPC call to add and/or remove the given value(s) from the shared
	 * state.
	 * @param {?(string|Object.<!string, !string>)} addState  Either an object
	 *     denoting the desired key value pair(s), or a single string key.
	 * @param {?(string|Object.<!string, !string>)=} opt_removeState A list of
	 *     keys to remove from the shared state.
	 */
	var submitDeltaInternal = function(addState, opt_removeState) {
		gapi.hangout.data.submitDelta(addState, opt_removeState);
	};

	saveValue = function(keyOrState, opt_value) {
		var delta = prepareForSave(keyOrState, opt_value);
		if (delta) {
			submitDeltaInternal(delta);
		}
	};

	removeValue = function(keyOrListToRemove) {
		var delta = prepareForRemove(keyOrListToRemove);
		if (delta) {
			submitDeltaInternal({}, delta);
		}
	};

	submitDelta = function(addState, opt_removeState) {
		if ((typeof addState !== 'object' && typeof addState !== 'undefined') ||
			(typeof opt_removeState !== 'object' &&
				typeof opt_removeState !== 'undefined')) {
			throw 'Unexpected value for submitDelta';
		}
		var toAdd = addState ? prepareForSave(addState) : {};
		var toRemove = opt_removeState ? prepareForRemove(opt_removeState) :
			undefined;
		submitDeltaInternal(toAdd, toRemove);
	};
})();

/**
 * Stores the user's answer in the shared state, or removes it from the shared
 * state if it is the same as the current value.
 * @param {!Answers} newAnswer The user's answer.
 */
function onAnswer(newAnswer) {
	// Gets the temporary hangout id, corresponding to Participant.id
	// rather than Participant.id.
	var myId = getUserHangoutId();

	var answerKey = makeUserKey(myId, 'answer');
	var activeUserStory = getActiveUserStory();
	var current = getState(activeUserStory+answerKey);
	console.dir(activeUserStory);
	if(activeUserStory === null) {
		console.log("no active story");
		return;
	}
	if (current === newAnswer) {
		removeValue(activeUserStory+answerKey);
		setVoteStatus("FALSE");
	} else {
		saveValue(activeUserStory+answerKey, newAnswer);
		setVoteStatus("TRUE");
	}
}

/**
 * @param {!string} participantId The temporary id of a Participant.
 * @return {string} The status of the given Participant.
 */
function getStatusMessage(participantId) {
	return getState(makeUserKey(participantId, 'status'));
}

/**
 * Sets the status for the current user.
 * @param {!string} message The user's new status.
 */
function setStatusMessage(message) {
	saveValue(makeUserKey(getUserHangoutId(), 'status'), message);
}

/**
 * @param {!string} participantId The temporary id of a Participant.
 * @return {string} The voteStatus of the given Participant.
 */
function getVoteStatus(participantId) {
	return getState(makeUserKey(participantId, 'voteStatus'));
}

/**
 * Sets the status for the current user.
 * @param {!string} message The user's new status.
 */
function setVoteStatus(message) {
	saveValue(makeUserKey(getUserHangoutId(), 'voteStatus'), message);
}

/**
 * @param {!string} userStoryID.
 * @return {string} The user story.
 */
function getUserStory(userStoryID) {
	return getState(makeUserKey(userStoryID, 'userStory'));
}

/**
 * Sets the status for the current user.
 * @param {!string} message The user's new status.
 */
function setUserStory(message) {
	saveValue(makeUserKey(new Date().getTime(), 'userStory'), message);
}

/**
 * @param {!string} participantId The temporary id of a Participant.
 * @return {string} The status of the given Participant.
 */
function getActiveUserStory() {
	return getState('activeUserStory');
}

/**
 * Sets the status for the current user.
 * @param {!string} id The user's new status.
 */
function setActiveUserStory(id) {
	saveValue('activeUserStory', id);
}

/**
 * Displays the input allowing a user to set his status.
 * @param {!Element} linkElement The link that triggered this handler.
 */
function onSetStatus(linkElement) {
	console.dir(linkElement);
	statusVisible_ = true;
	statusInput_.fadeIn(500);
	$(linkElement).parent('p').hide();
	$(linkElement).parent('p').parent().append(statusInput_);
	statusInput_.val(getStatusMessage(getUserHangoutId()));
	// Since faceIn is a black box, focus & select only if the input is already
	// visible.
	statusInput_.filter(':visible').focus().select();
}

/**
 * Sets the user's status message and hides the input element.
 */
function onSubmitStatus() {
	if (statusVisible_) {
		statusVisible_ = false;
		var statusVal = statusInput_.val();
		statusVal = statusVal.length < MAX_STATUS_LENGTH ? statusVal :
			statusVal.substr(0, MAX_STATUS_LENGTH);
		setStatusMessage(statusVal);
		statusForm_.append(statusInput_);
		statusInput_.hide();
		render();
	}
}

/**
 * Displays the input allowing a user to set his status.
 * @param {!Element} linkElement The link that triggered this handler.
 */
function onSetUserStory(linkElement) {
	console.dir(linkElement);
	userStoryVisible_ = true;
	userStoryInput_.fadeIn(500);
	$(linkElement).parent('p').hide();
	$(linkElement).parent('p').parent().append(userStoryInput_);
	userStoryInput_.val(getUserStory(getUserHangoutId()));
	// Since faceIn is a black box, focus & select only if the input is already
	// visible.
	userStoryInput_.filter(':visible').focus().select();
}

/**
 * Sets the user's status message and hides the input element.
 */
function onSubmitUserStory() {
	if (userStoryVisible_) {
		userStoryVisible_ = false;
		var userStoryVal = userStoryInput_.val();
		userStoryVal = userStoryVal.length < MAX_STATUS_LENGTH ? userStoryVal :
			userStoryVal.substr(0, MAX_STATUS_LENGTH);
		setUserStory(userStoryVal);
		userStoryForm_.append(userStoryInput_);
		userStoryInput_.hide();

		render();
	}
}
/**
 * Gets the value of opt_stateKey in the shared state, or the entire state
 * object if opt_stateKey is null or not supplied.
 * @param {?string=} opt_stateKey The key to get from the state object.
 * @return {(string|Object.<string,string>)} A state value or the state object.
 */
function getState(opt_stateKey) {
	return (typeof opt_stateKey === 'string') ? state_[opt_stateKey] : state_;
}

/**
 * Gets the value of opt_metadataKey in the shared state, or the entire
 * metadata object if opt_metadataKey is null or not supplied.
 * @param {?string=} opt_metadataKey The key to get from the metadata object.
 * @return {(Object.<string,*>|Object<string,Object.<string,*>>)} A metadata
 *     value or the metadata object.
 */
function getMetadata(opt_metadataKey) {
	return (typeof opt_metadataKey === 'string') ? metadata_[opt_metadataKey] :
		metadata_;
}

/**
 * @return {string} The user's ephemeral id.
 */
function getUserHangoutId() {
	return gapi.hangout.getLocalParticipantId();
}
/**
 * @ return {object}
 */
function getAllUserStories (){
	var allUserStories = {};
	for (var key in state_) {
		var re = /\w+:userstory$/g;
		var storyMatched = key.match(re);
		console.log(storyMatched);

		if(storyMatched.length > 0) {
			allUserStories[key] = state_[key];
		}
	}
	return allUserStories;
}
/**
 *
 * @param {?string=} storyID The key to get from the state object.
 * @return {Array} Array of current Answers.
 */
function getAnswersById (storyID) {
	var activeUserStory = getActiveUserStory();
	var answerArray = {};
	if(activeUserStory === null) {
		return null
	}
	var re = /\w:userstory\w+:answers/g;
	var answerList = activeUserStory.match(re);
	console.log(answerList);
	for(var answer in answerList ) {
		answerArray.push(anser);
	}
	console.log(answer);
	return answer;
}
/**
 *
 */
function toggleAnswer() {
	var activeUserStory = getActiveUserStory();

}
/**
 * Renders the app.
 */
function render() {
	if (!state_ || !metadata_ || !participants_ || !container_) {
		console.log("nope");
		return;
	}

	if (statusVisible_) {
		console.log("nope visible");
		// Wait until we're done editing status, otherwise everything will render,
		// messing up our edit.
		return;
	}

	var data = {
		total: 0,
		responded: false
	};
	data[Answers.ZERO] = [];
	data[Answers.HALF] = [];
	data[Answers.ONE] = [];
	data[Answers.TWO] = [];
	data[Answers.THREE] = [];
	data[Answers.FIVE] = [];
	data[Answers.EIGHT] = [];
	data[Answers.UNKNOWN] = [];
	data[Answers.COFFEE] = [];

	var myId = getUserHangoutId();
	for (var i = 0, iLen = participants_.length; i < iLen; ++i) {
		var p = participants_[i];
		// Temporary id, corresponds to getUserHangoutId().
		var answerKey = makeUserKey(p.id, 'answer');
		var activeUserStory = getActiveUserStory();
		var answer = getState(activeUserStory+':'+answerKey);
		var meta = getMetadata(answerKey);
		if (answer && data[answer]) {
			data[answer].push(p);
			if (p.id === myId) {
				data.responded = true;
			}
			++data.total;

			var name = p.person.displayName;
			var parts = name.split('@');
			if (parts && parts.length > 1) {
				p.person.displayName = parts[0];
			}

			p.status = getStatusMessage(p.id) || '';
			// The server stores a timestamp for us on each change. We'll use this
			// value to display users in the order in which they answer.
			p.sortOrder = meta.timestamp;
		}
	}

	// Sort by vote order.
	var sortFunc = function(a, b) {
		return a.sortOrder - b.sortOrder;
	};
	for (var answer in data) {
		if (data.hasOwnProperty(answer) && data[answer].sort) {
			data[answer].sort(sortFunc);
		}
	}

	container_
		.empty()
		.append(createUserStory(data), createAddUserStory(), createAnswersTable(data));
}

/**
 * Syncs local copies of shared state with those on the server and renders the
 *     app to reflect the changes.
 * @param {!Object.<!string, !string>} state The shared state.
 * @param {!Object.<!string, Object.<!string, *>>} metadata Data describing the
 *     shared state.
 */
function updateLocalDataState(state, metadata) {
	state_ = state;
	metadata_ = metadata;
	render();
}

/**
 * Syncs local copy of the participants list with that on the server and renders
 *     the app to reflect the changes.
 * @param {!Array.<gapi.hangout.Participant>} participants The new list of
 *     participants.
 */
function updateLocalParticipantsData(participants) {
	participants_ = participants;
	render();
}

/**
 * Create required DOM elements and listeners.
 */
function prepareAppDOM() {
	statusInput_ = $('<input />')
		.attr({
			'id': 'status-input',
			'type': 'text',
			'maxlength': MAX_STATUS_LENGTH
		});
	statusForm_ = $('<form />')
		.attr({
			'action': '',
			'id': 'status-form'
		})
		.append(statusInput_);

	var statusDiv = $('<div />')
		.attr('id', 'status-box')
		.addClass('status-box')
		.append(statusForm_);

	statusForm_.submit(function() {
		onSubmitStatus();
		return false;
	});

	statusInput_.keypress(function(e) {
		if (e.which === 13) {
				defer(onSubmitStatus);
		}
		e.stopPropagation();
	}).blur(function(e) {
			onSubmitStatus();
			e.stopPropagation();
		}).mousedown(function(e) {
			e.stopPropagation();
		}).hide();

	// userStory DOM
	userStoryInput_ = $('<input />')
		.attr({
			'id': 'userStory-input',
			'type': 'text',
			'maxlength': MAX_STATUS_LENGTH
		});
	userStoryForm_ = $('<form />')
		.attr({
			'action': '',
			'id': 'userStory-form'
		})
		.append(userStoryInput_);

	var userStoryDiv = $('<div />')
		.attr('id', 'userStory-box')
		.addClass('userStory-box')
		.append(userStoryForm_);

	userStoryForm_.submit(function() {
		onSubmitUserStory();
		return false;
	});

	userStoryInput_.keypress(function(e) {
		if (e.which === 13) {
				defer(onSubmitUserStory());
		}
		e.stopPropagation();
	}).blur(function(e) {
			onSubmitUserStory();
			e.stopPropagation();
		}).mousedown(function(e) {
			e.stopPropagation();
		}).hide();

	container_ = $('<div />');

	var body = $('body');
	body.mousedown(function(e) {
		if (statusVisible_) {
			onSubmitStatus();
		}
		else if(userStoryVisible_) {
			onSubmitUserStory();
		}
		e.stopPropagation();
	}).append(container_,statusDiv, userStoryDiv);
}

/**
 * Creates the DOM element that shows the current user story
 * @param {!Object.<!string, *>} data The information used to populate the
 *     user story.
 * @return {Element} The DOM element displaying the app's main interface.
 */
function createUserStory (Data){
	var storyListDOM = $('<ul />')
	var storyList = getAllUserStories();
	console.log("bla");
	console.dir(storyList);

	try{
		for(var story in storyList ) {
			var ansLink = $('<a />')
				.attr('href', '#')
				.css('background-color', 'red')
				.text('Activate')
				.click(function() {
					return false;
				});

			var showBtn = $('<div />')
				.addClass('button')
				.css('width', '200px')
				.append(ansLink)
				.mouseup(function() {
						ansLink.css('background-color','green');
						setActiveUserStory(story);
						console.log("pressed");
					}
				);
			var userStorySingle = $('<li />')
				.append($('<p/>').text(storyList[story] + ' ('+0+'/'+ participants_.length+')'), showBtn);
			storyListDOM.append(userStorySingle);
		}
	} catch (e) {
		console.dir(e);
	}
	return storyListDOM;
}


/**
 * Creates the DOM element that shows the current user story
 * @param {!Object.<!string, *>} data The information used to populate the
 *     user story.
 * @return {Element} The DOM element displaying the app's main interface.
 */
function createAddUserStory(data) {
	var userStory = $('<div />')
		.attr('class', 'story-list');
	var headLine = $('<p />')
		.text('Create new user story');
	var statusText = '';
	var hideButtonHandler = function() {
		return function() {
			$('.respondList').show();
			console.log("pressed");
		};
	};

	userStory.append(headLine);
	var triggerLink = $('<a href="#" class="link" />')
		.text(statusText ? 'Edit' : 'Add Story')
		.click(function() {
			onSetUserStory(this);
			return false;
		});

	headLine.append(triggerLink);
	return userStory;
}
/**
 * Creates the DOM element that shows the button for each response and displays
 * each participant under his answer.
 * @param {!Object.<!string, *>} data The information used to populate the
 *     table.
 * @return {Element} The DOM element displaying the app's main interface.
 */
function createAnswersTable(data) {
	var buttonRow = $('<tr />');

	var onButtonMouseDown = function() {
		$(this).addClass('selected');
	};
	var getButtonMouseUpHandler = function(ans) {
		return function() {
			$(this).removeClass('selected');
			onAnswer(ans);
		};
	};

	// Create buttons for each possible response.
	for (var key in Answers) {
		if (Answers.hasOwnProperty(key)) {
			var ans = Answers[key];
			var numAnswered = $('<span />')
				.text(' (' + data[ans].length + ')');
			var ansLink = $('<a />')
				.attr('href', '#')
				.text(DEFAULT_STATUS[ans])
				.append(numAnswered)
				.click(function() {
					return false;
				});
			var ansBtn = $('<div />')
				.addClass('button')
				.append(ansLink)
				.mousedown(onButtonMouseDown)
				.mouseup(getButtonMouseUpHandler(ans));

			var respondList = $('<ul />')
				.attr('class','respondList')
				.hide();
			for (var i = 0, iLen = data[ans].length; i < iLen; ++i) {
				respondList.append(createParticipantElement(data[ans][i]));
			}
			var ansCell = $('<td />')
				.attr('id', key)
				.css('width', (100/Object.keys(Answers).length)+'%')
				.append(ansBtn, respondList);

			// Add list of participants below each button.
			buttonRow.append(ansCell);
		}
	}
	var participantRow = $('<tr />');
	var participantList = $('<ul />');
	for (var i = 0, iLen = participants_.length; i < iLen; ++i) {
		participantList.append(createParticipantElement(participants_[i]));
	}
	participantRow.append(participantList);
	var controlRow = $('<tr />');
	var hideButtonHandler = function() {
		return function() {
			$('.respondList').show();
			console.log("pressed");
		};
	};
	var ansLink = $('<a />')
		.attr('href', '#')
		.text('toggle')
		.click(function() {
			return false;
		});
	var showBtn = $('<div />')
		.addClass('button')
		.append(ansLink)
		.mouseup(hideButtonHandler());
	controlRow.append(showBtn);

	var table = $('<table />')
		.attr({
			'cellspacing': '2',
			'cellpadding': '0',
			'summary': '',
			'width': '100%'
		}).append(buttonRow, controlRow, participantRow);

	if (!data.responded) {
		var instructImg = $('<img />')
			.attr({
				'src': '//hangoutsapi.appspot.com/static/yesnomaybe/directions.png',
				'title': 'Make a selection'
			});
		var instructText = $('<div />')
			.text('Click an option to cast your vote');
		var footDiv = $('<div />').append(instructImg, instructText);
		var footCell = $('<td colspan="3" />')
			.append(footDiv);
		var footRow = $('<tr />')
			.attr('id', 'footer')
			.addClass('footer')
			.append(footCell);

		table.append(footRow);
	}

	return table;
}

/**
 * Creates the DOM element that shows a single participant's answer.
 * @param {!gapi.hangout.Participant} participant The participant to create the
 *     display element for.
 * @param {!Answers} response The participant's answer.
 * @return {Element} A DOM element which shows a participant and allows him to
 *     modify his status.
 */
function createParticipantElement(participant) {
	var avatar = $('<img />').attr({
		'width': '27',
		'alt': 'Avatar',
		'class': 'avatar',
		'src': participant.person.image && participant.person.image.url ?
			participant.person.image.url : ''
	});

	var name = $('<h2 />').text(participant.person.displayName);

	var statusText = getStatusMessage(participant.id) || '';
	var statusAnchor = $('<p />')
		.addClass('status-anchor')
		.text(statusText + ' ');
	if (participant.id === getUserHangoutId()) {
		var triggerLink = $('<a href="#" class="link" />')
			.text(statusText ? 'Edit' : 'Set your status')
			.click(function() {
				onSetStatus(this);
				return false;
			});

		statusAnchor.append(triggerLink);
	}
	var color = 'white';
	if(getVoteStatus(participant.id) == 'FALSE') {
		color = 'red';
	} else if (getVoteStatus(participant.id) == 'TRUE') {
		color = 'green';
	}
	else {
		color = 'white';
	}

		return $('<li />').append(avatar, name, statusAnchor)
		.css('background-color',color);
}

(function() {
	if (gapi && gapi.hangout) {
		var initHangout = function(apiInitEvent) {
			if (apiInitEvent.isApiReady) {
				prepareAppDOM();
				console.dir(state_);
				getAllUserStories();
				gapi.hangout.data.onStateChanged.add(function(stateChangeEvent) {
					updateLocalDataState(stateChangeEvent.state,
						stateChangeEvent.metadata);
					console.dir(state_);
					getAllUserStories();
				});
				gapi.hangout.onParticipantsChanged.add(function(partChangeEvent) {
					updateLocalParticipantsData(partChangeEvent.participants);
				});

				if (!state_) {
					var state = gapi.hangout.data.getState();
					var metadata = gapi.hangout.data.getStateMetadata();
					if (state && metadata) {
						updateLocalDataState(state, metadata);
					}
				}
				if (!participants_) {
					var initParticipants = gapi.hangout.getParticipants();
					if (initParticipants) {
						updateLocalParticipantsData(initParticipants);
					}
				}

				gapi.hangout.onApiReady.remove(initHangout);
			}
		};

		gapi.hangout.onApiReady.add(initHangout);
	}
})();