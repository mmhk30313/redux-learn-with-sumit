import io from "socket.io-client";
import { apiSlice } from "../api/apiSlice";
import { messagesApi } from "../messages/messagesApi";

export const conversationsApi = apiSlice.injectEndpoints({
    endpoints: (builder) => ({
        getConversations: builder.query({
            query: (email) =>
                `/conversations?participants_like=${email}&_sort=timestamp&_order=desc&_page=1&_limit=${process.env.REACT_APP_CONVERSATIONS_PER_PAGE}`,
            transformResponse(apiResponse, meta) {
                const totalCount = meta.response.headers.get("X-Total-Count");
                return {
                    data: apiResponse,
                    totalCount,
                };
            },
            async onCacheEntryAdded(
                arg,
                { updateCachedData, cacheDataLoaded, cacheEntryRemoved }
            ) {
                // create socket
                // const socket = io("http://localhost:9000", {
                const socket = io(process.env.REACT_APP_LIVE_URL || "http://localhost:9000", {
                    reconnectionDelay: 1000,
                    reconnection: true,
                    reconnectionAttemps: 10,
                    transports: ["websocket"],
                    agent: false,
                    upgrade: false,
                    rejectUnauthorized: false,
                });

                try {
                    await cacheDataLoaded;
                    socket.on("conversation", (data) => {
                        updateCachedData((draft) => {
                            const conversation = draft.data.find(
                                (c) => c.id == data?.data?.id
                            );

                            // console.log({ conversation });
                            if (conversation?.id) {
                                conversation.senderName = data?.data?.senderName;
                                conversation.senderEmail = data?.data?.senderEmail;
                                conversation.message = data?.data?.message;
                                conversation.timestamp = data?.data?.timestamp;
                            } else {
                                // do nothing
                                draft.data.unshift(data?.data);
                            }
                        });
                    });

                } catch (err) {}

                await cacheEntryRemoved;
                socket.close();
            },
        }),
        getMoreConversations: builder.query({
            query: ({ email, page }) =>
                `/conversations?participants_like=${email}&_sort=timestamp&_order=desc&_page=${page}&_limit=${process.env.REACT_APP_CONVERSATIONS_PER_PAGE}`,
            async onQueryStarted({ email }, { queryFulfilled, dispatch }) {
                try {
                    const conversations = await queryFulfilled;
                    console.log({ conversations });
                    if (conversations?.data?.length > 0) {
                        // update conversation cache pessimistically start
                        dispatch(
                            apiSlice.util.updateQueryData(
                                "getConversations",
                                email,
                                (draft) => {
                                    return {
                                        data: [
                                            ...draft.data,
                                            ...conversations.data,
                                        ],
                                        totalCount: Number(draft.totalCount),
                                    };
                                }
                            )
                        );
                        // update messages cache pessimistically end
                    }
                } catch (err) {}
            },
        }),
        getConversation: builder.query({
            query: ({ userEmail, participantEmail }) =>
                `/conversations?participants_like=${userEmail}-${participantEmail}&&participants_like=${participantEmail}-${userEmail}`,
        }),
        addConversation: builder.mutation({
            query: ({ sender, data }) => ({
                url: "/conversations",
                method: "POST",
                body: data,
            }),
            async onQueryStarted(arg, { queryFulfilled, dispatch }) {

                try {
                    const conversation = await queryFulfilled;
                    if (conversation?.data?.id) {
                        // silent entry to message table
                        const users = arg.data.users;
                        const senderUser = users.find(
                            (user) => user.email === arg.sender
                        );
                        const receiverUser = users.find(
                            (user) => user.email !== arg.sender
                        );
    
                        const res = await dispatch(
                            messagesApi.endpoints.addMessage.initiate({
                                conversationId: conversation?.data?.id,
                                sender: senderUser,
                                receiver: receiverUser,
                                message: arg.data.message,
                                timestamp: arg.data.timestamp,
                            })
                        ).unwrap();

                        // update messages cache pessimistically start
                        dispatch(
                            apiSlice.util.updateQueryData(
                                "getMessages",
                                res.conversationId.toString(),
                                (draft) => {
                                    draft.data.unshift(res);
                                }
                            )
                        );
                        // update messages cache pessimistically end
                    }
                } catch (err) {
                    console.log(err); 
                    // rollback cache update start
                    // pathResult.undo();
                    // rollback cache update end
                }


            },
        }),
        editConversation: builder.mutation({
            query: ({ id, data, sender }) => ({
                url: `/conversations/${id}`,
                method: "PATCH",
                body: data,
            }),
            async onQueryStarted(arg, { queryFulfilled, dispatch }) {
                // optimistic cache update start
                const pathResult = dispatch(
                    apiSlice.util.updateQueryData(
                        "getConversations",
                        arg.sender,
                        (draft) => {
                            const draftConversation = draft.data.find(
                                (c) => c.id == arg.id
                            );
                            draftConversation.senderName = arg.data.senderName;
                            draftConversation.senderEmail = arg.data.senderEmail;
                            draftConversation.message = arg.data.message;
                            draftConversation.timestamp = arg.data.timestamp;
                        }
                    )
                );
                // optimistic cache update end

                try {
                    const conversation = await queryFulfilled;
                    if (conversation?.data?.id) {
                        // silent entry to message table
                        const users = arg.data.users;
                        const senderUser = users.find(
                            (user) => user.email === arg.sender
                        );
                        const receiverUser = users.find(
                            (user) => user.email !== arg.sender
                        );

                        const res = await 
                        dispatch(
                            messagesApi.endpoints.addMessage.initiate({
                                conversationId: conversation?.data?.id,
                                sender: senderUser,
                                receiver: receiverUser,
                                message: arg.data.message,
                                timestamp: arg.data.timestamp,
                            })
                        )
                        .unwrap();
                        
                        console.log({ res });
                        // // update messages cache pessimistically start
                        dispatch(
                            apiSlice.util.updateQueryData(
                                "getMessages",
                                res?.toString(),
                                (draft) => {
                                    // console.log({ draft_data: draft.data });
                                    draft.data.unshift(res);
                                }
                            )
                        )

                        // console.log({ msgRes });
                        // update messages cache pessimistically end
                    }
                } catch (err) {
                    pathResult.undo();
                }
            },
        }),
    }),
});

export const {
    useGetConversationsQuery,
    useGetConversationQuery,
    useAddConversationMutation,
    useEditConversationMutation,
} = conversationsApi;
