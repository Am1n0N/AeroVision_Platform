const ChatLayout = ({
    children
}:{
    children: React.ReactNode;
}) => {
    return (
        <div className="mx-auto w-full h-full">
                {children}
        </div>
    );
}

export default ChatLayout;
