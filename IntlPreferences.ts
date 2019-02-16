import { IModule } from "@sb-types/ModuleLoader/Interfaces.new";
import { ModulePrivateInterface } from "@sb-types/ModuleLoader/PrivateInterface";
import { unloadMethod, initializationMethod } from "@sb-types/ModuleLoader/Decorators";
import { MessagesFlows, IMessageFlowContext, IPublicFlowCommand } from "@cogs/cores/messagesFlows/messagesFlows";
import { createRedirector } from "@utils/command";
import * as i18n from "@utils/ez-i18n";
import { EmbedType, getMessageMemberOrAuthor } from "@utils/utils";
import { GuildMember } from "discord.js";
import * as getLogger from "loggy";
import { intlAcceptsTimezone } from "@utils/extensions";
import { DateTime } from "luxon";

const LOG = Symbol("logger");

const MESSAGES_FLOWS_HANDLER = Symbol("messagesFlowsHandler");
const I18N_UNHANDLE = Symbol("i18nHandler");

const SET_LANGUAGE = Symbol("setLanguage");
const SET_TIMEZONE = Symbol("setTimezone");
const SET_ENFORCING = Symbol("setEnforcing");
const TO_LANGUAGE_NAME = Symbol("toLanguageName");

const LIST = Symbol("list");

export class LanguagePreferences implements IModule<LanguagePreferences> {
	private static [LOG] = getLogger("LanguagePreferences");

	private [I18N_UNHANDLE]: () => void;
	private [MESSAGES_FLOWS_HANDLER]: IPublicFlowCommand;

	@initializationMethod
	async init(i: ModulePrivateInterface<LanguagePreferences>) {
		const messageFlowsKeeper = i.getDependency<MessagesFlows>("messages-flows");

		if (!messageFlowsKeeper) throw new Error("Messages flows cannot be found");

		// TODO: Commands to implement:

		// set language <langCode> - sets user language
		// set timezone <timezone> - sets user timezone
		
		// guild_set language <langCode> - sets guild's language
		// guild_set timezone <timezone> - sets guild's timezone

		// list - shows a list of languages

		this[I18N_UNHANDLE] = await i18n.extendAndAssign([__dirname, "i18n"], i);

		const redirector = createRedirector<IMessageFlowContext>({
			"set": (ctx) => this._onSetCalled(ctx, "USER"),
			"server_set": (ctx) => this._onSetCalled(ctx, "GUILD"),
			"list": (ctx) => LanguagePreferences[LIST](ctx)
		}, { basedOn: "subcommand" });

		messageFlowsKeeper.onInit(
			(mf) => {
				this[MESSAGES_FLOWS_HANDLER] = mf.watchForCommands(
					(ctx) => redirector(ctx.parsed, ctx),
					"intl"
				);
			}
		);
	}

	private async _onSetCalled(ctx: IMessageFlowContext, scope: "GUILD" | "USER") {
		const { parsed, message: msg } = ctx;

		const author = await getMessageMemberOrAuthor(msg);

		if (!author) return;

		if (scope === "GUILD") {
			if (msg.channel.type !== "text") {
				return msg.channel.send({
					embed: await i18n.generateLocalizedEmbed(
						EmbedType.Error,
						author,
						"LANGUAGE_PREFERENCE_SET_DM",
					)
				});
			}

			if (!(author instanceof GuildMember)) return;
			
			if (!author.permissions.has("MANAGE_GUILD")) {
				return msg.channel.send({
					embed: await i18n.generateLocalizedEmbed(
						EmbedType.Information,
						author,
						"LANGUAGE_PREFERENCE_SET_PERMISSIONS"
					)
				});
			}
		}

		if (!parsed.arguments || parsed.arguments.length !== 2) {
			return msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(
					EmbedType.Information,
					author,
					`LANGUAGE_PREFERENCE_HELP_SET@${scope}`
				)
			});
		}

		const [param, value] = parsed.arguments.only("value");

		switch (param) {
			case "language": case "lang": {
				return LanguagePreferences[SET_LANGUAGE](ctx, scope, value, author);
			}
			case "timezone": case "tz": {
				return LanguagePreferences[SET_TIMEZONE](ctx, scope, value, author);
			}
			case "enforce": case "enf": {
				return LanguagePreferences[SET_ENFORCING](ctx, value, author);
			}
		}
	}

	private static async [SET_TIMEZONE](ctx: IMessageFlowContext, scope: "GUILD" | "USER", timezone: string, caller: i18n.UserIdentify) {
		const { message: msg } = ctx;

		if (!intlAcceptsTimezone(timezone)) {
			return msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(
					EmbedType.Error,
					caller, {
						key: "LANGUAGE_PREFERENCE_SET_INVALID_TIMEZONE",
						formatOptions: { timezone }
					}
				)
			});
		}

		let currentTime: string;

		if (scope === "USER") {
			await i18n.setUserTimezone(caller, timezone);

			currentTime = await i18n.toUserLocaleString(caller, Date.now(), DateTime.DATETIME_FULL_WITH_SECONDS);
		} else {
			await i18n.setGuildTimezone(msg.guild, timezone);

			currentTime = await i18n.toGuildLocaleString(msg.guild, Date.now(), DateTime.DATETIME_FULL_WITH_SECONDS);
		}

		return msg.channel.send({
			embed: await i18n.generateLocalizedEmbed(
				EmbedType.OK,
				caller, {
					key: `LANGUAGE_PREFERENCE_SET_DONE_TIMEZONE@${scope}`,
					formatOptions: { currentTime, timezone }
				}
			)
		});
	}

	private static async [SET_LANGUAGE](ctx: IMessageFlowContext, scope: "GUILD" | "USER", language: string, caller: i18n.UserIdentify) {
		const { message: msg } = ctx;

		if (!$localizer.loadedLanguages.includes(language)) {
			return msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(
					EmbedType.Error,
					caller, {
						key: "LANGUAGE_PREFERENCE_SET_INVALID_LANGCODE",
						formatOptions: { code: language, prefix: ctx.prefix! }
					}
				)
			});
		}

		if (scope === "USER") await i18n.setUserLanguage(caller, language);
		else await i18n.setGuildLanguage(msg.guild, language);

		return msg.channel.send({
			embed: await i18n.generateLocalizedEmbed(
				EmbedType.OK,
				caller, {
					key: `LANGUAGE_PREFERENCE_SET_DONE@${scope}`,
					formatOptions: {
						language: LanguagePreferences[TO_LANGUAGE_NAME](language)
					}
				}
			)
		});
	}

	private static async [SET_ENFORCING](ctx: IMessageFlowContext, state: string, caller: i18n.UserIdentify) {
		const { message: msg } = ctx;

		if (msg.channel.type !== "text") {
			return msg.channel.send({
				embed: await i18n.generateLocalizedEmbed(
					EmbedType.Error,
					caller,
					"LANGUAGE_PREFERENCE_ENFORCING_DM"
				)
			});
		}

		let enable: boolean;

		switch (state.toLowerCase()) {
			case "+": case "enable": case "true": { enable = true; } break;
			case "-": case "disable": case "false": { enable = false; } break;
			default: {
				return msg.channel.send({
					embed: await i18n.generateLocalizedEmbed(
						EmbedType.Error,
						caller, {
							key: "LANGUAGE_PREFERENCE_SET_INVALID_STATE",
							formatOptions: { state }
						}
					)
				});
			}
		}

		await i18n.setGuildEnforce(msg.guild, enable);

		return msg.channel.send({
			embed: await i18n.generateLocalizedEmbed(
				EmbedType.Error,
				caller,
				`LANGUAGE_PREFERENCE_SET_ENFORCE_DONE@${enable ? "ENABLED" : "DISABLED"}`
			)
		});
	}

	private static async [LIST](ctx: IMessageFlowContext) {
		const { message: msg } = ctx;

		const author = await getMessageMemberOrAuthor(msg);

		if (!author) return;

		let list = "";

		const userLanguage = await i18n.getUserLanguage(author);

		const languages = $localizer.loadedLanguages;

		for (let i = 0, l = languages.length; i < l; i++) {
			const language = languages[i];

			const name = LanguagePreferences[TO_LANGUAGE_NAME](language);

			list += `${$localizer.getFormattedString(userLanguage, "LANGUAGE_PREFERENCE_LIST_LANGUAGE", {
				code: language,
				name
			})}\n`;
		}

		return msg.channel.send({
			embed: await i18n.generateLocalizedEmbed(
				EmbedType.Information,
				author, {
					key: "LANGUAGE_PREFERENCE_LIST",
					formatOptions: {
						languages: list
					}
				}, {
					universalTitle: $localizer.getString(userLanguage, "LANGUAGE_PREFERENCE_LIST_TITLE")
				}
			)
		});
	}

	private static [TO_LANGUAGE_NAME](language: string) {
		let str: string;

		try {
			str = $localizer.getString(language, "+NAME", false);
		} catch {
			return $localizer.getString(language, "LANGUAGE_PREFERENCE_NO_NAME");
		}

		try {
			str += ` (${$localizer.getString(language, "+COUNTRY", false)})`;
		} catch {
			LanguagePreferences[LOG]("info", `Language "${language}" does not have country name set`);
		}

		return str;
	}

	@unloadMethod
	async unload() {
		if (this[MESSAGES_FLOWS_HANDLER]) this[MESSAGES_FLOWS_HANDLER].unhandle();

		if (this[I18N_UNHANDLE]) this[I18N_UNHANDLE]();

		return true;
	}
}

export default LanguagePreferences;
